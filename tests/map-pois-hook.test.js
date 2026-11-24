'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCreateHandler(countRecords) {
    let createHandlerSource;
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        onRecordCreateRequest(handler, name) {
            if (name === 'map_pois') createHandlerSource = handler.toString();
        },
        onRecordUpdateRequest() {}
    });
    const hook = fs.readFileSync(
        path.join(__dirname, '..', 'pb_hooks', 'map_pois.pb.js'),
        'utf8'
    );
    vm.runInContext(hook, context);
    return vm.runInContext(`(${createHandlerSource})`, vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: {
            countRecords,
            findRecordById(collection, id) {
                assert.equal(collection, 'users');
                assert.equal(id, 'user123');
                return { getString: name => name === 'nickname' ? 'Rider' : '' };
            }
        },
        $dbx: {
            hashExp(values) {
                return { kind: 'hash', values };
            }
        }
    }));
}

function createEvent({ superuser = false } = {}) {
    return {
        hasSuperuserAuth: () => superuser,
        auth: { id: 'user123' },
        record: {
            values: { owner: 'user123', name: 'Bar' },
            getString(name) {
                return this.values[name] || '';
            },
            get(name) {
                return { lat: 40.1, lng: -3.2 }[name];
            },
            set(name, value) { this.values[name] = value; }
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
    assert.equal(event.record.values.createdBy, 'Rider');
    assert.equal(event.record.values.quotaExemptForLimit, false);
    assert.equal(event.nextCalled, true);
});

test('map POI update hook replaces a supplied author with the account nickname', () => {
    let updateHandlerSource;
    const context = vm.createContext({
        onRecordCreateRequest() {},
        onRecordUpdateRequest(handler, name) {
            if (name === 'map_pois') updateHandlerSource = handler.toString();
        }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'map_pois.pb.js'), 'utf8'),
        context
    );
    const updateHandler = vm.runInContext(`(${updateHandlerSource})`, vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: {
            findRecordById() {
                return { getString: name => name === 'nickname' ? 'Rider' : '' };
            }
        }
    }));
    const event = createEvent();
    event.record.values.createdBy = 'Impersonated';
    updateHandler(event);

    assert.equal(event.record.values.createdBy, 'Rider');
    assert.equal(event.nextCalled, true);
});

test('map POI create hook rejects accounts at the shared POI limit', () => {
    const handler = loadCreateHandler(() => 500);
    const event = createEvent();

    assert.throws(() => handler(event), /máximo de 500 puntos compartidos/);
    assert.equal(event.nextCalled, false);
});

test('map POI create hook marks superuser records as exempt from the owner limit', () => {
    const handler = loadCreateHandler(() => {
        throw new Error('superuser requests must not count POIs');
    });
    const event = createEvent({ superuser: true });

    handler(event);

    assert.equal(event.record.values.quotaExemptForLimit, true);
    assert.equal(event.nextCalled, true);
});
