'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCreateHandler(countRecords) {
    let createHandler;
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: { countRecords },
        $dbx: {
            hashExp(values) {
                return { kind: 'hash', values };
            }
        },
        onRecordCreateRequest(handler, name) {
            if (name === 'map_pois') createHandler = handler;
        }
    });
    const hook = fs.readFileSync(
        path.join(__dirname, '..', 'pb_hooks', 'map_pois.pb.js'),
        'utf8'
    );
    vm.runInContext(hook, context);
    return createHandler;
}

function createEvent() {
    return {
        hasSuperuserAuth: () => false,
        auth: { id: 'user123' },
        record: {
            getString(name) {
                return { owner: 'user123', name: 'Bar' }[name] || '';
            },
            get(name) {
                return { lat: 40.1, lng: -3.2 }[name];
            }
        },
        nextCalled: false,
        next() { this.nextCalled = true; }
    };
}

test('map POI create hook counts records with a PocketBase dbx expression', () => {
    let countArgs;
    const handler = loadCreateHandler((...args) => {
        countArgs = args;
        return 2;
    });
    const event = createEvent();

    handler(event);

    assert.equal(countArgs[0], 'map_pois');
    assert.equal(countArgs[1].kind, 'hash');
    assert.equal(countArgs[1].values.owner, 'user123');
    assert.equal(event.nextCalled, true);
});

test('map POI create hook rejects accounts at the shared POI limit', () => {
    const handler = loadCreateHandler(() => 500);
    const event = createEvent();

    assert.throws(() => handler(event), /máximo de 500 puntos compartidos/);
    assert.equal(event.nextCalled, false);
});
