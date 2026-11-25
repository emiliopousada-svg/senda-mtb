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
                    put(value) {
                        records.set(value.routeId ?? value.id, value);
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

test('remote-deleted routes remain recoverable with photos until restored or retention expires', async () => {
    const { context } = storageContext();
    const db = memoryDatabase({
        routes: [{ id: 51, name: 'Ridge', remoteId: 'remote-51', remoteServer: 'https://server.example', points: [] }],
        routePhotos: [{ routeId: 51, photos: [{ index: 0, photo: 'photo-data' }] }]
    });
    context.testDB.db = db;

    assert.equal(await context.testDB.moveRouteToTrash(51, {
        remoteId: 'remote-51',
        server: 'https://server.example'
    }), true);
    assert.deepEqual(await context.testDB.all(), []);
    assert.equal((await context.testDB.allTrashedRoutes())[0].name, 'Ridge');
    assert.ok(db.records.get('routePhotos').has(51));

    const restored = await context.testDB.restoreTrashedRoute(51);
    assert.equal(restored.name, 'Ridge');
    assert.equal(restored.remoteId, null);
    assert.deepEqual(await context.testDB.all(), [restored]);
    assert.ok(db.records.get('routePhotos').has(51));
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
