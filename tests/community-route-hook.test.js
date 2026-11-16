'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('community route create hook trims the track and calculates its bounds', () => {
    let createHandler;
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: {
            findRecordById(collection, id) {
                assert.equal(collection, 'users');
                assert.equal(id, 'user123');
                return { getString: name => name === 'nickname' ? 'Rider' : '' };
            }
        },
        onRecordCreateRequest(handler, name) {
            if (name === 'community_routes') createHandler = handler;
        },
        onRecordUpdateRequest() {}
    });
    const hook = fs.readFileSync(
        path.join(__dirname, '..', 'pb_hooks', 'community_routes.pb.js'),
        'utf8'
    );
    vm.runInContext(hook, context);

    const values = {
        owner: 'user123',
        trackJson: JSON.stringify([[[0, 0], [0.001, 0.001], [0.5, 0.5]]]),
        poisJson: '[]'
    };
    let nextCalled = false;
    createHandler({
        hasSuperuserAuth: () => false,
        auth: { id: 'user123' },
        record: {
            getString(name) { return values[name] || ''; },
            get(name) { return values[name]; },
            set(name, value) { values[name] = value; }
        },
        next() { nextCalled = true; }
    });

    assert.equal(nextCalled, true);
    assert.equal(values.createdBy, 'Rider');
    const trimmed = JSON.parse(values.trackJson);
    assert.ok(trimmed[0].length >= 2);
    assert.ok(trimmed[0][0][0] > 0);
    assert.equal(Number.isFinite(values.minLat), true);
    assert.equal(Number.isFinite(values.maxLat), true);
    assert.equal(Number.isFinite(values.minLng), true);
    assert.equal(Number.isFinite(values.maxLng), true);
});
