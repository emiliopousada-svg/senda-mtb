'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadHandlers(nickname = 'Rider') {
    const handlers = {};
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: {
            findRecordById(collection, id) {
                assert.equal(collection, 'users');
                assert.equal(id, 'user123');
                return { getString: name => name === 'nickname' ? nickname : '' };
            }
        },
        onRecordCreateRequest(handler, name) { handlers[`create:${name}`] = handler; },
        onRecordUpdateRequest(handler, name) { handlers[`update:${name}`] = handler; }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'live_locations_author.pb.js'), 'utf8'),
        context
    );
    return handlers;
}

test('live location create and update hooks use the authenticated account nickname', () => {
    const handlers = loadHandlers();
    for (const action of ['create', 'update']) {
        const values = { owner: 'user123', name: 'Impersonated' };
        let nextCalled = false;
        handlers[`${action}:live_locations`]({
            hasSuperuserAuth: () => false,
            auth: { id: 'user123' },
            record: {
                getString: name => values[name] || '',
                set(name, value) { values[name] = value; }
            },
            next() { nextCalled = true; }
        });
        assert.equal(values.name, 'Rider');
        assert.equal(nextCalled, true);
    }
});

test('live location hook rejects a record owned by another account', () => {
    const handlers = loadHandlers();
    assert.throws(() => handlers['create:live_locations']({
        hasSuperuserAuth: () => false,
        auth: { id: 'user123' },
        record: { getString: () => 'another-user' },
        next() {}
    }), /propietario de la posición no coincide/);
});
