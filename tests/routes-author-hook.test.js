'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('route create and update hooks always use the authenticated account nickname', () => {
    const handlers = {};
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: {
            findRecordById(collection, id) {
                assert.equal(collection, 'users');
                assert.equal(id, 'user123');
                return { getString: name => name === 'nickname' ? 'Rider' : '' };
            }
        },
        onRecordCreateRequest(handler, name) { handlers[`create:${name}`] = handler; },
        onRecordUpdateRequest(handler, name) { handlers[`update:${name}`] = handler; }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'routes_author.pb.js'), 'utf8'),
        context
    );

    for (const action of ['create', 'update']) {
        const values = { owner: 'user123', createdBy: 'Impersonated' };
        let nextCalled = false;
        handlers[`${action}:routes`]({
            hasSuperuserAuth: () => false,
            auth: { id: 'user123' },
            record: {
                getString: name => values[name] || '',
                set(name, value) { values[name] = value; }
            },
            next() { nextCalled = true; }
        });
        assert.equal(values.createdBy, 'Rider');
        assert.equal(nextCalled, true);
    }
});
