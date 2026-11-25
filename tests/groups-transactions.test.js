'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const groupsUtils = require('../pb_hooks/groups_utils.js');

class MockRecord {
    constructor(collection, id = '', values = {}) {
        this.collection = collection;
        this.id = id;
        this.values = { ...values };
    }

    set(field, value) { this.values[field] = value; }
    getString(field) { return String(this.values[field] ?? ''); }
    getFloat(field) { return Number(this.values[field]) || 0; }
    getBool(field) { return this.values[field] === true; }
}

function groupHookEnvironment({ failUserSave = false, enforceQuota = () => {}, verified = true } = {}) {
    let nextId = 1;
    let state = new Map([
        ['users', new Map([['user-1', new MockRecord({ name: 'users' }, 'user-1', { nickname: 'Rider', groupCode: '', verified })]])],
        ['mtb_groups', new Map()],
        ['mtb_group_members', new Map()]
    ]);

    function snapshot() {
        return new Map(Array.from(state, ([name, records]) => [
            name,
            new Map(Array.from(records, ([id, record]) => [id, new MockRecord(record.collection, id, record.values)]))
        ]));
    }

    function createApp(getState = () => state) {
        return {
            findCollectionByNameOrId(name) { return { name }; },
            findRecordById(collection, id) {
                const record = getState().get(collection)?.get(id);
                if (!record) throw new Error(`Missing ${collection} record ${id}`);
                return record;
            },
            findRecordsByFilter(collection, _filter, _sort, limit, offset, params = {}) {
                let records = Array.from(getState().get(collection)?.values() || []);
                if (params.group) records = records.filter(record => record.getString('group') === params.group);
                if (params.user) records = records.filter(record => record.getString('user') === params.user);
                return records.slice(offset, offset + limit);
            },
            save(record) {
                if (failUserSave && record.collection.name === 'users') throw new Error('injected save failure');
                if (!record.id) record.id = `record-${nextId++}`;
                getState().get(record.collection.name).set(record.id, record);
            },
            delete(record) { getState().get(record.collection.name).delete(record.id); }
        };
    }

    const app = createApp();
    app.runInTransaction = callback => {
        const before = snapshot();
        const transactionState = snapshot();
        const previousNextId = nextId;
        try {
            const result = callback(createApp(() => transactionState));
            state = transactionState;
            return result;
        } catch (error) {
            state = before;
            nextId = previousNextId;
            throw error;
        }
    };

    const routes = new Map();
    const context = vm.createContext({
        $app: app,
        $apis: { requireAuth() { return () => {}; } },
        $security: { randomString() { return 'ABCDEF123456'; } },
        __hooks: 'hooks',
        routerAdd(_method, route, handler) { routes.set(route, handler); },
        require(name) {
            if (name === 'hooks/community_quota_utils.js') {
                return { enforceCommunityWriteQuota: enforceQuota };
            }
            return groupsUtils;
        },
        DynamicModel: class {
            constructor(defaults) { Object.assign(this, defaults); }
        },
        Record: MockRecord
    });
    const file = path.join(__dirname, '..', 'pb_hooks', 'groups.pb.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

    return {
        app,
        routes,
        getRecords(collection) { return Array.from(state.get(collection).values()); }
    };
}

function createGroupRequest() {
    return {
        auth: { id: 'user-1' },
        bindBody(model) { model.name = 'Weekend riders'; },
        findUploadedFiles() { return []; },
        json(status, body) { return { status, body }; }
    };
}

test('group creation rolls back group and membership if updating the user fails', () => {
    const { routes, getRecords } = groupHookEnvironment({ failUserSave: true });

    const response = routes.get('/api/mtb/groups/create')(createGroupRequest());

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'No se pudo crear el grupo.');
    assert.deepEqual(getRecords('mtb_groups'), []);
    assert.deepEqual(getRecords('mtb_group_members'), []);
    assert.equal(getRecords('users')[0].getString('groupCode'), '');
});

test('group creation commits the group, membership, and active group together', () => {
    const { routes, getRecords } = groupHookEnvironment();

    const response = routes.get('/api/mtb/groups/create')(createGroupRequest());

    assert.equal(response.status, 200);
    assert.equal(getRecords('mtb_groups').length, 1);
    assert.equal(getRecords('mtb_group_members').length, 1);
    assert.equal(getRecords('users')[0].getString('groupCode'), getRecords('mtb_groups')[0].id);
});

test('group creation rejects an exhausted quota without persisting partial records', () => {
    const { routes, getRecords } = groupHookEnvironment({
        enforceQuota() {
            const error = new Error('group quota reached');
            error.clientMessage = error.message;
            throw error;
        }
    });

    const response = routes.get('/api/mtb/groups/create')(createGroupRequest());

    assert.equal(response.status, 400);
    assert.match(response.body.message, /group quota reached/);
    assert.deepEqual(getRecords('mtb_groups'), []);
    assert.deepEqual(getRecords('mtb_group_members'), []);
    assert.equal(getRecords('users')[0].getString('groupCode'), '');
});

test('group creation returns a safe message for internal errors', () => {
    const { routes } = groupHookEnvironment({ failUserSave: true });

    const response = routes.get('/api/mtb/groups/create')(createGroupRequest());

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'No se pudo crear el grupo.');
    assert.doesNotMatch(response.body.message, /injected save failure/);
});

test('group creation rejects unverified accounts without persisting records', () => {
    const { routes, getRecords } = groupHookEnvironment({ verified: false });

    const response = routes.get('/api/mtb/groups/create')(createGroupRequest());

    assert.equal(response.status, 403);
    assert.match(response.body.message, /Verifica tu correo electrónico/);
    assert.deepEqual(getRecords('mtb_groups'), []);
    assert.deepEqual(getRecords('mtb_group_members'), []);
    assert.equal(getRecords('users')[0].getString('groupCode'), '');
});

test('challenge count and insert both run inside the same transaction', () => {
    const transactions = [];
    let inTransaction = false;
    const txApp = {
        findCollectionByNameOrId(name) { return { name }; },
        save(record) {
            assert.equal(inTransaction, true);
            record.id = 'challenge-1';
        }
    };
    const app = {
        runInTransaction(callback) {
            inTransaction = true;
            transactions.push('started');
            try { return callback(txApp); }
            finally { inTransaction = false; }
        }
    };
    const utils = {
        CHALLENGE_MAX_ACTIVE: 20,
        loadActiveGroupContext(_id, transactionApp) {
            assert.equal(transactionApp, txApp);
            return { groupId: 'group-1', user: { id: 'user-1', verified: true } };
        },
        requireVerifiedCommunityUser(user) {
            if (!user.verified) {
                const error = new Error('Verification required');
                error.status = 403;
                throw error;
            }
        },
        validateChallengeInput() {
            return { name: 'Distance', metric: 'distance', target: 100, startsAtMs: 1, endsAtMs: 2 };
        },
        findAllRecordsByFilter(_collection, _filter, _sort, transactionApp) {
            assert.equal(transactionApp, txApp);
            assert.equal(inTransaction, true);
            return [];
        },
        challengeFromRecord(record) { return record; },
        challengeStatus() { return 'active'; }
    };
    const routes = new Map();
    const context = vm.createContext({
        $app: app,
        $apis: { requireAuth() { return () => {}; } },
        __hooks: 'hooks',
        routerAdd(_method, route, handler) { routes.set(route, handler); },
        require() { return utils; },
        DynamicModel: class {
            constructor(defaults) { Object.assign(this, defaults); }
        },
        Record: MockRecord,
        Date
    });
    const file = path.join(__dirname, '..', 'pb_hooks', 'group_league.pb.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

    const response = routes.get('/api/mtb/groups/challenges')({
        auth: { id: 'user-1' },
        bindBody() {},
        json(status, body) { return { status, body }; }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.id, 'challenge-1');
    assert.deepEqual(transactions, ['started']);
});

test('group challenge creation rejects an unverified account before writing', () => {
    let saves = 0;
    const user = {
        id: 'user-1',
        getBool() { return false; }
    };
    const app = {
        runInTransaction(callback) { return callback(this); },
        save() { saves++; }
    };
    const utils = {
        requireVerifiedCommunityUser: groupsUtils.requireVerifiedCommunityUser,
        loadActiveGroupContext() { return { user, groupId: 'group-1' }; },
        validateChallengeInput() {
            return { name: 'Distance', metric: 'distance', target: 100, startsAtMs: 1, endsAtMs: 2 };
        }
    };
    const routes = new Map();
    const context = vm.createContext({
        $app: app,
        $apis: { requireAuth() { return () => {}; } },
        __hooks: 'hooks',
        routerAdd(method, route, handler) { routes.set(`${method} ${route}`, handler); },
        require() { return utils; },
        DynamicModel: class {
            constructor(defaults) { Object.assign(this, defaults); }
        },
        Date
    });
    const file = path.join(__dirname, '..', 'pb_hooks', 'group_league.pb.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

    const response = routes.get('POST /api/mtb/groups/challenges')({
        auth: { id: 'user-1' },
        bindBody() {},
        json(status, body) { return { status, body }; }
    });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /Verifica tu correo electrónico/);
    assert.equal(saves, 0);
});
