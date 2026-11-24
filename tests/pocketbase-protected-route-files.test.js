'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runMigration({ fieldType = 'file', isProtected = false, includeField = true } = {}) {
    let up;
    let saveCount = 0;
    const track = {
        protected: isProtected,
        type() { return fieldType; }
    };
    const fields = includeField ? [track] : [];
    const collection = {
        name: 'routes',
        fields: {
            getByName(name) { return name === 'track' ? fields[0] || null : null; }
        }
    };
    const app = {
        findCollectionByNameOrId(name) {
            assert.equal(name, 'routes');
            return collection;
        },
        save(savedCollection) {
            assert.equal(savedCollection, collection);
            saveCount++;
        }
    };
    const context = vm.createContext({
        migrate(callback) { up = callback; }
    });
    vm.runInContext(
        fs.readFileSync(
            path.join(__dirname, '..', 'pb_migrations', '1794836011_protect_route_track_files.js'),
            'utf8'
        ),
        context
    );
    up(app);
    return { track, saveCount };
}

test('route track migration protects an existing unprotected file field', () => {
    const { track, saveCount } = runMigration();

    assert.equal(track.protected, true);
    assert.equal(saveCount, 1);
});

test('route track migration is idempotent for an already protected field', () => {
    const { track, saveCount } = runMigration({ isProtected: true });

    assert.equal(track.protected, true);
    assert.equal(saveCount, 0);
});

test('route track migration rejects a missing or incompatible field', () => {
    assert.throws(() => runMigration({ includeField: false }), /routes\.track field is missing/);
    assert.throws(() => runMigration({ fieldType: 'text' }), /routes\.track must be a file field/);
});
