'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeRecord {
    constructor(id, fields = {}) {
        this.id = id;
        this.fields = { ...fields };
    }
    getString(name) { return String(this.fields[name] || ''); }
    set(name, value) { this.fields[name] = value; }
}

function groupHandlers() {
    let app;
    const records = {
        users: [new FakeRecord('user-1', { groupCode: 'group-1', nickname: 'Rider' })],
        mtb_groups: [new FakeRecord('group-1', { owner: 'admin-1' })],
        mtb_group_members: [new FakeRecord('member-1', { group: 'group-1', user: 'user-1' })],
        live_locations: [new FakeRecord('location-1', { owner: 'user-1', groupCode: 'group-1' })]
    };
    app = {
        findRecordById(collection, id) {
            const record = records[collection].find(item => item.id === id);
            if (!record) throw new Error(`Missing ${collection} record ${id}`);
            return record;
        },
        findRecordsByFilter(collection, _filter, _sort, limit, offset, params) {
            const values = records[collection].filter(record => {
                if (collection === 'mtb_group_members') {
                    return record.fields.group === params.group && record.fields.user === params.user;
                }
                if (collection === 'live_locations') {
                    return record.fields.owner === params.owner && record.fields.groupCode === params.group;
                }
                return false;
            });
            return values.slice(offset, offset + limit);
        },
        runInTransaction(callback) { return callback(this); },
        save() {},
        delete(record) {
            for (const collection of Object.values(records)) {
                const index = collection.indexOf(record);
                if (index >= 0) collection.splice(index, 1);
            }
        }
    };
    const utils = {
        requireSafeValue(value, label) {
            const result = String(value || '').trim();
            if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new Error(`${label} inválido`);
            return result;
        },
        requireNickname(value) { return String(value || '').trim(); },
        safeMembership(groupId, userId) {
            return app.findRecordsByFilter('mtb_group_members', '', '', 1, 0, {
                group: groupId,
                user: userId
            });
        }
    };
    const handlers = new Map();
    const context = vm.createContext({
        DynamicModel: class {
            constructor(fields) { Object.assign(this, fields); }
        },
        __hooks: 'hooks',
        $app: app,
        $apis: { requireAuth() { return () => {}; } },
        require() { return utils; },
        routerAdd(method, route, handler) { handlers.set(`${method} ${route}`, handler); }
    });
    const source = fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'groups.pb.js'), 'utf8');
    for (const route of ['/api/mtb/groups/leave', '/api/mtb/groups/select']) {
        const start = source.indexOf(`routerAdd("POST", "${route}"`);
        const end = source.indexOf('\nrouterAdd(', start + 1);
        assert.notEqual(start, -1);
        assert.notEqual(end, -1);
        vm.runInContext(source.slice(start, end), context);
    }
    return { handlers, records };
}

function event(body = {}) {
    const headers = {};
    return {
        auth: { id: 'user-1' },
        bindBody(model) { Object.assign(model, { groupId: 'group-1' }, body); },
        json(status, result) { return { status, body: result }; },
        response: { header() { return { set(name, value) { headers[name] = value; } }; } },
        headers
    };
}

test('leaving a group revokes membership and prevents reactivation without a new invite', () => {
    const { handlers, records } = groupHandlers();

    const left = handlers.get('POST /api/mtb/groups/leave')(event());
    const reselected = handlers.get('POST /api/mtb/groups/select')(event({ groupId: 'group-1' }));

    assert.equal(left.status, 200);
    assert.equal(records.users[0].fields.groupCode, '');
    assert.equal(records.mtb_group_members.length, 0);
    assert.equal(records.live_locations.length, 0);
    assert.equal(reselected.status, 403);
});

test('a pending leave removes only its target membership and preserves the newly active group', () => {
    const { handlers, records } = groupHandlers();
    records.users[0].fields.groupCode = 'group-2';
    records.mtb_groups.push(new FakeRecord('group-2', { owner: 'admin-2' }));
    records.mtb_group_members.push(new FakeRecord('member-2', { group: 'group-2', user: 'user-1' }));

    const pendingLeave = handlers.get('POST /api/mtb/groups/leave')(event({ groupId: 'group-1' }));

    assert.equal(pendingLeave.status, 200);
    assert.equal(records.users[0].fields.groupCode, 'group-2');
    assert.deepEqual(records.mtb_group_members.map(record => record.fields.group), ['group-2']);
    assert.equal(records.live_locations.length, 0);
});
