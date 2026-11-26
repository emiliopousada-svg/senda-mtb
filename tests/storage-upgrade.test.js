'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function storageContext() {
    const state = { request: null, messages: [] };
    const context = {
        window: { indexedDB: {} },
        indexedDB: {
            open(name, version) {
                state.request = { name, version };
                return state.request;
            }
        },
        Blob,
        console: { warn() {} },
        toast: message => state.messages.push(message)
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'storage.js'), 'utf8'), context);
    vm.runInContext('globalThis.testDB = DB', context);
    return { context, state };
}

function memoryDatabase(seed = {}) {
    const stores = new Map(Object.entries(seed).map(([name, records]) => [
        name,
        new Map(records.map(record => [record.routeId ?? record.id, record]))
    ]));
    const finishTransaction = tx => {
        if (tx.pending !== 0 || tx.completed) return;
        queueMicrotask(() => {
            if (tx.pending !== 0 || tx.completed) return;
            tx.completed = true;
            if (tx.oncomplete) tx.oncomplete();
        });
    };
    return {
        transaction() {
            const tx = { pending: 0, completed: false };
            const schedule = (request, operation) => {
                tx.pending++;
                queueMicrotask(() => {
                    request.result = operation();
                    if (request.onsuccess) request.onsuccess({ target: request });
                    tx.pending--;
                    finishTransaction(tx);
                });
                return request;
            };
            tx.objectStore = name => {
                if (!stores.has(name)) stores.set(name, new Map());
                const records = stores.get(name);
                return {
                    get(key) { return schedule({}, () => records.get(key)); },
                    getAll() { return schedule({}, () => Array.from(records.values())); },
                    put(value, key) {
                        records.set(key ?? value.routeId ?? value.id, value);
                        return {};
                    },
                    delete(key) {
                        records.delete(key);
                        return {};
                    },
                    openCursor() {
                        const request = {};
                        const entries = Array.from(records.entries());
                        let index = 0;
                        const dispatch = () => schedule(request, () => {
                            if (index >= entries.length) return null;
                            const [key, value] = entries[index];
                            return {
                                value,
                                delete() { records.delete(key); },
                                continue() {
                                    index++;
                                    dispatch();
                                }
                            };
                        });
                        return dispatch();
                    }
                };
            };
            return tx;
        },
        records: stores
    };
}

test('IndexedDB closes its connection when another tab requests a version upgrade', async () => {
    const { context, state } = storageContext();
    let closed = false;
    const db = { close() { closed = true; } };
    const opening = context.testDB.open();
    state.request.result = db;
    state.request.onsuccess();
    await opening;

    db.onversionchange();

    assert.equal(closed, true);
    assert.equal(context.testDB.db, null);
});

test('IndexedDB explains when an old tab blocks the schema upgrade', () => {
    const { context, state } = storageContext();
    context.testDB.open();

    state.request.onblocked();

    assert.match(state.messages[0], /Cierra las otras pesta/);
});

test('route photo replacements clear stale blobs without affecting legacy writes', async () => {
    const { context } = storageContext();
    const operations = [];
    context.testDB.db = {
        transaction() {
            const tx = {
                objectStore(name) {
                    return {
                        put(value) { operations.push(['put', name, value.routeId ?? value.id]); },
                        delete(key) { operations.push(['delete', name, key]); }
                    };
                }
            };
            queueMicrotask(() => tx.oncomplete());
            return tx;
        }
    };

    await context.testDB.put({ id: 41, pois: [] }, { replacePhotos: true });
    await context.testDB.put({ id: 42, pois: [] });

    assert.deepEqual(operations, [
        ['put', 'routes', 41],
        ['delete', 'routePhotos', 41],
        ['put', 'routes', 42]
    ]);
});

test('key-value updates transform the latest value in one read-write transaction', async () => {
    const { context } = storageContext();
    const db = memoryDatabase({ kv: [] });
    const initial = [{ remoteId: 'pending-route', server: 'https://server.example', ownerId: 'user-1' }];
    db.records.get('kv').set('pendingDeletes', initial);
    context.testDB.db = db;

    const updated = await context.testDB.kvUpdate('pendingDeletes', current => [
        ...current,
        { remoteId: 'new-route', server: 'https://server.example', ownerId: 'user-1' }
    ]);

    assert.deepEqual(updated, [
        ...initial,
        { remoteId: 'new-route', server: 'https://server.example', ownerId: 'user-1' }
    ]);
    assert.deepEqual(db.records.get('kv').get('pendingDeletes'), updated);
});

test('remote-deleted routes remain recoverable with photos until restored or retention expires', async () => {
    const { context } = storageContext();
    const db = memoryDatabase({
        routes: [{ id: 51, name: 'Ridge', remoteId: 'remote-51', remoteServer: 'https://server.example', remoteOwnerId: 'user-1', points: [] }],
        routePhotos: [{ routeId: 51, photos: [{ index: 0, photo: 'photo-data' }] }]
    });
    context.testDB.db = db;

    assert.equal(await context.testDB.moveRouteToTrash(51, {
        remoteId: 'remote-51',
        server: 'https://server.example',
        ownerId: 'user-1'
    }), true);
    assert.deepEqual(await context.testDB.all(), []);
    assert.equal((await context.testDB.allTrashedRoutes())[0].name, 'Ridge');
    assert.ok(db.records.get('routePhotos').has(51));

    const restored = await context.testDB.restoreTrashedRoute(51);
    assert.equal(restored.name, 'Ridge');
    assert.equal(restored.remoteId, null);
    assert.equal(restored.remoteOwnerId, undefined);
    assert.equal(restored.trashRemoteOwnerId, undefined);
    assert.deepEqual(await context.testDB.all(), [restored]);
    assert.ok(db.records.get('routePhotos').has(51));
});

test('manually deleted routes move to personal trash and queue remote deletion without losing photos', async () => {
    const { context } = storageContext();
    const db = memoryDatabase({
        routes: [{ id: 52, name: 'Forest loop', remoteId: 'remote-52', remoteServer: 'https://server.example', remoteOwnerId: 'user-1', points: [] }],
        routePhotos: [{ routeId: 52, photos: [{ index: 0, photo: 'photo-data' }] }],
        kv: []
    });
    context.testDB.db = db;
    db.records.get('kv').set('pendingDeletes', [{
        remoteId: 'remote-52',
        server: 'https://another-server.example',
        ownerId: 'user-1'
    }]);
    const readKv = key => JSON.parse(JSON.stringify(Array.from(db.records.get('kv').get(key))));

    assert.equal(await context.testDB.moveRouteToTrash(52, {
        remoteId: 'remote-52',
        server: 'https://server.example',
        ownerId: 'user-1'
    }, {
        ownerId: 'user-1',
        server: 'https://server.example',
        clientId: 52
    }, { reason: 'user-deleted', queueRemoteDelete: true }), true);
    assert.deepEqual(await context.testDB.all(), []);
    assert.equal((await context.testDB.allTrashedRoutes())[0].trashReason, 'user-deleted');
    assert.deepEqual(readKv('pendingDeletes'), [
        {
            remoteId: 'remote-52',
            server: 'https://another-server.example',
            ownerId: 'user-1'
        },
        {
            remoteId: 'remote-52',
            server: 'https://server.example',
            ownerId: 'user-1'
        }
    ]);
    assert.deepEqual(readKv('pendingGroupRankingDeletes'), [{
        ownerId: 'user-1',
        server: 'https://server.example',
        clientId: 52
    }]);
    assert.ok(db.records.get('routePhotos').has(52));

    const restored = await context.testDB.restoreTrashedRoute(52);
    assert.equal(restored.remoteId, null);
    assert.equal(restored.remoteOwnerId, undefined);
    assert.equal(restored.trashRemoteOwnerId, undefined);
    assert.deepEqual(readKv('pendingDeletes'), [{
        remoteId: 'remote-52',
        server: 'https://another-server.example',
        ownerId: 'user-1'
    }]);
    assert.ok(db.records.get('routePhotos').has(52));
});

test('remote route deletion rejects incomplete origin before removing local data', async () => {
    const { context } = storageContext();
    const db = memoryDatabase({
        routes: [{ id: 53, name: 'River loop', remoteId: 'remote-53' }],
        routePhotos: [],
        kv: []
    });
    context.testDB.db = db;

    await assert.rejects(
        context.testDB.deleteRoute(53, 'remote-53', null),
        /remote-delete-origin-required/
    );

    assert.equal(db.records.get('routes').has(53), true);
    assert.equal(db.records.get('kv').has('pendingDeletes'), false);
});

test('moving a route to trash rejects an incomplete remote-delete origin', async () => {
    const { context } = storageContext();
    const db = memoryDatabase({
        routes: [{ id: 54, name: 'Forest loop', remoteId: 'remote-54' }],
        kv: []
    });
    context.testDB.db = db;

    await assert.rejects(
        context.testDB.moveRouteToTrash(54, {
            remoteId: 'remote-54',
            server: 'https://server.example',
            ownerId: ''
        }, null, { queueRemoteDelete: true }),
        /remote-delete-metadata-missing/
    );

    assert.equal(db.records.get('routes').get(54).trashedAt, undefined);
    assert.equal(db.records.get('kv').has('pendingDeletes'), false);
});

test('expired trash purging removes route photos but preserves newer and active routes', async () => {
    const { context } = storageContext();
    const now = Date.now();
    const db = memoryDatabase({
        routes: [
            { id: 61, name: 'Expired', trashedAt: now - 30 * 24 * 60 * 60 * 1000 - 1 },
            { id: 62, name: 'Recent', trashedAt: now - 1000 },
            { id: 63, name: 'Active' }
        ],
        routePhotos: [
            { routeId: 61, photos: ['expired-photo'] },
            { routeId: 62, photos: ['recent-photo'] }
        ]
    });
    context.testDB.db = db;

    assert.equal(await context.testDB.purgeExpiredTrashedRoutes(now), 1);
    assert.equal(db.records.get('routes').has(61), false);
    assert.equal(db.records.get('routePhotos').has(61), false);
    assert.equal(db.records.get('routes').has(62), true);
    assert.equal(db.records.get('routes').has(63), true);
});
