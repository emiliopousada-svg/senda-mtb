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
}

function accountHookEnvironment({ ownedGroup = false, failUserDelete = false } = {}) {
    let state = new Map([
        ['users', new Map([['user-1', new MockRecord('users', 'user-1', { groupCode: 'group-1' })]])],
        ['mtb_groups', new Map(ownedGroup
            ? [['group-1', new MockRecord('mtb_groups', 'group-1', { owner: 'user-1' })]]
            : [])],
        ['mtb_group_members', new Map([['membership-1', new MockRecord('mtb_group_members', 'membership-1', { user: 'user-1' })]])],
        ['live_locations', new Map([['location-1', new MockRecord('live_locations', 'location-1', { owner: 'user-1' })]])]
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
            delete(record) {
                if (failUserDelete && record.collection.name === 'users') {
                    throw new Error('injected user delete failure');
                }
                getState().get(record.collection.name).delete(record.id);
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
        DynamicModel: class {
            constructor(defaults) { Object.assign(this, defaults); }
        },
        routerAdd(method, route, handler, auth) { routes.set(route, { method, handler, auth }); }
    });
    const file = path.join(__dirname, '..', 'pb_hooks', 'account.pb.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

    return {
        routes,
        records(collection) { return Array.from(state.get(collection).values()); }
    };
}

function request(password) {
    return {
        auth: { id: 'user-1' },
        bindBody(model) { if (password !== undefined) model.password = password; },
        json(status, body) { return { status, body }; }
    };
}

test('account deletion requires an authenticated user route and a correct password', () => {
    const { routes, records } = accountHookEnvironment();
    const route = routes.get('/api/mtb/account/delete');

    assert.equal(route.method, 'POST');
    assert.equal(route.auth.collection, 'users');
    assert.equal(route.handler(request('incorrect')).status, 403);
    assert.equal(records('users').length, 1);
    assert.equal(route.handler(request()).status, 400);
});

test('account deletion refuses to remove a group owned by the account', () => {
    const { routes, records } = accountHookEnvironment({ ownedGroup: true });

    const response = routes.get('/api/mtb/account/delete').handler(request('correct horse'));

    assert.equal(response.status, 409);
    assert.match(response.body.message, /Transfiere la administración/);
    assert.equal(records('users').length, 1);
    assert.equal(records('mtb_groups').length, 1);
    assert.equal(records('mtb_group_members').length, 1);
    assert.equal(records('live_locations').length, 1);
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

test('account deletion rolls back cleanup when deleting the user fails', () => {
    const { routes, records } = accountHookEnvironment({ failUserDelete: true });

    const response = routes.get('/api/mtb/account/delete').handler(request('correct horse'));

    assert.equal(response.status, 400);
    assert.equal(records('users').length, 1);
    assert.equal(records('mtb_group_members').length, 1);
    assert.equal(records('live_locations').length, 1);
});
