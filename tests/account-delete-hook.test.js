'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class MockRecord {
    constructor(collection, id, values = {}, password = 'correct horse') {
        this.collection = { name: collection };
        this.id = id;
        this.values = { ...values };
        this.password = password;
    }

    getString(field) { return String(this.values[field] ?? ''); }
    validatePassword(password) { return password === this.password; }
    refreshTokenKey() { this.values.tokenKey = 'rotated'; }
}

function accountHookEnvironment({
    ownedGroup = false,
    failUserDelete = false,
    failUserSave = false,
    passwordAttempts = []
} = {}) {
    const errorLogs = [];
    const savedRecords = [];
    let state = new Map([
        ['users', new Map([['user-1', new MockRecord('users', 'user-1', { groupCode: 'group-1' })]])],
        ['mtb_groups', new Map(ownedGroup
            ? [['group-1', new MockRecord('mtb_groups', 'group-1', { owner: 'user-1' })]]
            : [])],
        ['mtb_group_members', new Map([['membership-1', new MockRecord('mtb_group_members', 'membership-1', { user: 'user-1' })]])],
        ['live_locations', new Map([['location-1', new MockRecord('live_locations', 'location-1', { owner: 'user-1' })]])],
        ['mtb_community_write_quota_events', new Map(passwordAttempts.map((createdAt, index) => [
            `delete-attempt-${index + 1}`,
            new MockRecord('mtb_community_write_quota_events', `delete-attempt-${index + 1}`, {
                owner: 'user-1',
                quota: 'account_delete_password',
                created_at: createdAt
            })
        ]))]
    ]);

    function cloneState(source) {
        return new Map(Array.from(source, ([name, records]) => [
            name,
            new Map(Array.from(records, ([id, record]) => [
                id,
                new MockRecord(name, id, record.values, record.password)
            ]))
        ]));
    }

    function createApp(getState) {
        return {
            findRecordById(collection, id) {
                const record = getState().get(collection)?.get(id);
                if (!record) throw new Error(`Missing ${collection} record ${id}`);
                return record;
            },
            findRecordsByFilter(collection, _filter, _sort, limit, offset, params = {}) {
                let records = Array.from(getState().get(collection)?.values() || []);
                if (params.owner) records = records.filter(record => record.getString('owner') === params.owner);
                if (params.user) records = records.filter(record => record.getString('user') === params.user);
                return records.slice(offset, offset + limit);
            },
            db() {
                return {
                    newQuery(query) {
                        let bindings = {};
                        const normalizedQuery = query.replace(/\s+/g, ' ').trim();
                        return {
                            bind(values) {
                                bindings = values;
                                return this;
                            },
                            one(result) {
                                assert.match(normalizedQuery, /^SELECT COUNT\(\*\) AS total FROM mtb_community_write_quota_events/);
                                const cutoff = Math.floor(Date.now() / 1000) - bindings.windowSeconds;
                                result.total = Array.from(getState().get('mtb_community_write_quota_events').values())
                                    .filter(record => record.getString('owner') === bindings.owner
                                        && record.getString('quota') === bindings.quota
                                        && Number(record.values.created_at) >= cutoff)
                                    .length;
                            },
                            execute() {
                                const events = getState().get('mtb_community_write_quota_events');
                                if (normalizedQuery.startsWith('INSERT INTO mtb_community_write_quota_events')) {
                                    const id = `delete-attempt-${events.size + 1}`;
                                    events.set(id, new MockRecord('mtb_community_write_quota_events', id, {
                                        owner: bindings.owner,
                                        quota: bindings.quota,
                                        created_at: Math.floor(Date.now() / 1000)
                                    }));
                                    return;
                                }
                                assert.match(normalizedQuery, /^DELETE FROM mtb_community_write_quota_events/);
                                for (const [id, record] of events) {
                                    if (record.getString('owner') === bindings.owner
                                        && record.getString('quota') === bindings.quota) {
                                        events.delete(id);
                                    }
                                }
                            }
                        };
                    }
                };
            },
            delete(record) {
                if (failUserDelete && record.collection.name === 'users') {
                    throw new Error('injected user delete failure');
                }
                getState().get(record.collection.name).delete(record.id);
            },
            save(record) {
                if (failUserSave && record.collection.name === 'users') {
                    throw new Error('injected user save failure');
                }
                savedRecords.push(record);
            }
        };
    }

    const app = createApp(() => state);
    app.runInTransaction = callback => {
        const transactionState = cloneState(state);
        const result = callback(createApp(() => transactionState));
        state = transactionState;
        return result;
    };

    const routes = new Map();
    const context = vm.createContext({
        $app: app,
        $apis: { requireAuth(collection) { return { collection }; } },
        console: { error(...args) { errorLogs.push(args); } },
        DynamicModel: class {
            constructor(defaults) { Object.assign(this, defaults); }
        },
        routerAdd(method, route, handler, auth) { routes.set(route, { method, handler, auth }); }
    });
    const file = path.join(__dirname, '..', 'pb_hooks', 'account.pb.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

    return {
        routes,
        errorLogs,
        savedRecords,
        records(collection) { return Array.from(state.get(collection).values()); }
    };
}

function request(password, auth = { id: 'user-1' }) {
    return {
        auth,
        bindBody(model) { if (password !== undefined) model.password = password; },
        json(status, body) { return { status, body }; }
    };
}

test('account logout rotates the auth token key and saves the user record', () => {
    const { routes, records, savedRecords } = accountHookEnvironment();
    const user = records('users')[0];
    const route = routes.get('/api/mtb/account/logout');

    const response = route.handler(request(undefined, user));

    assert.equal(route.method, 'POST');
    assert.equal(route.auth.collection, 'users');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(user.values.tokenKey, 'rotated');
    assert.deepEqual(savedRecords, [user]);
});

test('account logout reports token rotation failures without claiming success', () => {
    const { routes, records, errorLogs } = accountHookEnvironment({ failUserSave: true });
    const user = records('users')[0];

    const response = routes.get('/api/mtb/account/logout').handler(request(undefined, user));

    assert.equal(response.status, 500);
    assert.equal(response.body.message, 'No se pudo cerrar sesión en todos los dispositivos.');
    assert.doesNotMatch(response.body.message, /injected user save failure/);
    assert.equal(errorLogs.length, 1);
    assert.match(errorLogs[0][1], /injected user save failure/);
});

test('account deletion requires an authenticated user route and a correct password', () => {
    const { routes, records } = accountHookEnvironment();
    const route = routes.get('/api/mtb/account/delete');

    assert.equal(route.method, 'POST');
    assert.equal(route.auth.collection, 'users');
    assert.equal(route.handler(request('incorrect')).status, 403);
    assert.equal(records('mtb_community_write_quota_events').length, 1);
    assert.equal(records('users').length, 1);
    assert.equal(route.handler(request()).status, 400);
});

test('account deletion rejects attempts after five incorrect passwords in fifteen minutes', () => {
    const now = Math.floor(Date.now() / 1000);
    const { routes, records } = accountHookEnvironment({
        passwordAttempts: [now - 60, now - 50, now - 40, now - 30, now - 20]
    });

    const response = routes.get('/api/mtb/account/delete').handler(request('correct horse'));

    assert.equal(response.status, 429);
    assert.match(response.body.message, /límite de intentos/);
    assert.equal(records('users').length, 1);
    assert.equal(records('mtb_community_write_quota_events').length, 5);
});

test('account deletion refuses to remove a group owned by the account', () => {
    const { routes, records } = accountHookEnvironment({
        ownedGroup: true,
        passwordAttempts: [Math.floor(Date.now() / 1000) - 60]
    });

    const response = routes.get('/api/mtb/account/delete').handler(request('correct horse'));

    assert.equal(response.status, 409);
    assert.match(response.body.message, /Transfiere la administración/);
    assert.equal(records('users').length, 1);
    assert.equal(records('mtb_groups').length, 1);
    assert.equal(records('mtb_group_members').length, 1);
    assert.equal(records('live_locations').length, 1);
    assert.equal(records('mtb_community_write_quota_events').length, 0);
});

test('account deletion removes live location and membership in the same transaction', () => {
    const { routes, records } = accountHookEnvironment();

    const response = routes.get('/api/mtb/account/delete').handler(request('correct horse'));

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(records('users').length, 0);
    assert.equal(records('mtb_group_members').length, 0);
    assert.equal(records('live_locations').length, 0);
});

test('account deletion rolls back cleanup and reports internal failures as server errors', () => {
    const { routes, records, errorLogs } = accountHookEnvironment({ failUserDelete: true });

    const response = routes.get('/api/mtb/account/delete').handler(request('correct horse'));

    assert.equal(response.status, 500);
    assert.equal(response.body.message, 'No se pudo eliminar la cuenta.');
    assert.doesNotMatch(response.body.message, /injected user delete failure/);
    assert.equal(errorLogs.length, 1);
    assert.match(errorLogs[0][1], /injected user delete failure/);
    assert.equal(records('users').length, 1);
    assert.equal(records('mtb_group_members').length, 1);
    assert.equal(records('live_locations').length, 1);
});
