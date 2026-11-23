'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadNicknameHooks() {
    const handlers = {};
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        $app: {
            findRecordsByFilter(collection, filter, sort, limit, offset, params) {
                assert.equal(collection, 'users');
                assert.equal(filter, 'id != {:id} && nickname:lower = {:nickname}');
                assert.equal(sort, '');
                assert.equal(limit, 1);
                assert.equal(offset, 0);
                return params.matches || [];
            }
        },
        onRecordCreateRequest(handler, collection) {
            handlers.create = handler;
            assert.equal(collection, 'users');
        },
        onRecordUpdateRequest(handler, collection) {
            handlers.update = handler;
            assert.equal(collection, 'users');
        }
    });
    vm.runInContext(
        fs.readFileSync(path.join(root, 'pb_hooks', 'users_nickname.pb.js'), 'utf8'),
        context
    );
    return handlers;
}

function makeRecord(values, isNew) {
    const original = { ...values };
    return {
        values,
        isNew: () => isNew,
        original: () => ({ getString: (name) => String(original[name] || '') }),
        getString: (name) => String(values[name] || ''),
        set(name, value) { values[name] = value; }
    };
}

test('non-superusers cannot claim SENDA-MTB with different casing', () => {
    const hooks = loadNicknameHooks();
    const event = {
        record: makeRecord({ nickname: 'senda-mtb' }, true),
        hasSuperuserAuth: () => false,
        next() { assert.fail('reserved nickname should be rejected'); }
    };

    assert.throws(() => hooks.create(event), /reservado/);
});

test('superusers can assign the reserved nickname', () => {
    const hooks = loadNicknameHooks();
    let continued = false;
    const event = {
        record: makeRecord({ nickname: 'SENDA-MTB' }, true),
        hasSuperuserAuth: () => true,
        next() { continued = true; }
    };

    hooks.create(event);
    assert.equal(continued, true);
});

test('existing reserved nickname can keep updating unrelated profile data', () => {
    const hooks = loadNicknameHooks();
    let continued = false;
    const event = {
        record: makeRecord({ nickname: 'SENDA-MTB' }, false),
        hasSuperuserAuth: () => false,
        next() { continued = true; }
    };

    hooks.update(event);
    assert.equal(continued, true);
});

test('nickname index migration adds and removes a case-insensitive unique index', () => {
    let up;
    let down;
    let saveCount = 0;
    const users = {
        fields: { getByName: (name) => name === 'nickname' ? { type: () => 'text' } : null },
        indexes: ['CREATE INDEX idx_users_email ON users (email)']
    };
    const app = {
        findCollectionByNameOrId(name) {
            assert.equal(name, 'users');
            return users;
        },
        save(collection) {
            assert.equal(collection, users);
            saveCount++;
        }
    };
    const context = vm.createContext({
        migrate(upCallback, downCallback) {
            up = upCallback;
            down = downCallback;
        }
    });
    vm.runInContext(
        fs.readFileSync(path.join(root, 'pb_migrations', '1794836007_enforce_user_nickname_uniqueness.js'), 'utf8'),
        context
    );

    up(app);
    assert.deepEqual(users.indexes, [
        'CREATE INDEX idx_users_email ON users (email)',
        "CREATE UNIQUE INDEX idx_users_nickname_lower ON users (lower(nickname)) WHERE nickname != ''"
    ]);
    down(app);
    assert.deepEqual(users.indexes, ['CREATE INDEX idx_users_email ON users (email)']);
    assert.equal(saveCount, 2);
});

function runImporter(ownerId) {
    const owner = {
        id: 'official-user-id',
        getString(name) { return name === 'nickname' ? 'SENDA-MTB' : ''; }
    };
    const fileContent = JSON.stringify({
        type: 'Feature',
        properties: { name: 'Ruta oficial' },
        geometry: { type: 'LineString', coordinates: [[-8.5, 42.5], [-8.49, 42.5], [-8.48, 42.5]] }
    });
    const savedRecords = [];
    const cronJobs = [];
    let nicknameLookup = false;
    const context = vm.createContext({
        console: { log() {} },
        cronAdd(name, schedule, callback) { cronJobs.push({ name, schedule, callback }); },
        $filepath: { join: (...parts) => parts.join('/') },
        $os: {
            getenv(name) {
                if (name === 'COMMUNITY_IMPORT_DIR') return '/import';
                if (name === 'COMMUNITY_IMPORT_OWNER_ID') return ownerId;
                return '';
            },
            getwd: () => '/app',
            readDir: () => [{ name: () => 'route.geojson', isDir: () => false }],
            stat: () => ({ size: () => fileContent.length, modTime: () => ({ unixNano: () => 1 }) }),
            readFile: () => fileContent
        },
        Record: class {
            constructor(collection) {
                this.collection = collection;
                this.values = {};
            }
            load(values) { this.values = { ...values }; }
            set(name, value) { this.values[name] = value; }
            getString(name) { return String(this.values[name] || ''); }
        },
        $app: {
            findFirstRecordByData(collection, field, value) {
                if (collection === 'users' && field === 'nickname') nicknameLookup = true;
                throw new Error(`missing ${collection}.${field}=${value}`);
            },
            findRecordById(collection, id) {
                assert.equal(collection, 'users');
                assert.equal(id, 'official-user-id');
                return owner;
            },
            findCollectionByNameOrId(name) { return { name }; },
            save(record) { savedRecords.push(record); }
        }
    });
    vm.runInContext(
        fs.readFileSync(path.join(root, 'pb_hooks', 'community_routes_galicia_import.pb.js'), 'utf8'),
        context
    );
    assert.equal(cronJobs.length, 1);
    cronJobs[0].callback();
    return { savedRecords, nicknameLookup };
}

test('Galicia importer resolves the route owner by configured record ID', () => {
    const result = runImporter('official-user-id');
    const importedRoute = result.savedRecords.find((record) => record.collection.name === 'community_routes');

    assert.ok(importedRoute);
    assert.equal(importedRoute.values.owner, 'official-user-id');
    assert.equal(importedRoute.values.createdBy, 'SENDA-MTB');
    assert.equal(result.nicknameLookup, false);
});

test('Galicia importer fails closed when the owner ID is not configured', () => {
    const result = runImporter('');

    assert.equal(result.savedRecords.length, 0);
    assert.equal(result.nicknameLookup, false);
});
