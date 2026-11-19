'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const migrationPath = path.join(__dirname, '..', 'pb_migrations', '1794836002_add_user_home_location.js');

function runMigration(existingField = null) {
    let migrateUp;
    let saveCount = 0;
    const fields = existingField ? [existingField] : [];
    const users = {
        fields: {
            getByName(name) { return fields.find(field => field.name === name) || null; },
            add(field) { fields.push(field); }
        }
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
    class FakeTextField {
        constructor(definition) { Object.assign(this, definition); }
        type() { return 'text'; }
    }
    const context = vm.createContext({
        TextField: FakeTextField,
        migrate(callback) { migrateUp = callback; }
    });
    vm.runInContext(fs.readFileSync(migrationPath, 'utf8'), context);
    migrateUp(app);
    return { fields, saveCount };
}

test('user home locality migration adds a private 80-character text field', () => {
    const { fields, saveCount } = runMigration();
    assert.deepEqual(fields.map(({ name, max }) => ({ name, max })), [{ name: 'homeLocation', max: 80 }]);
    assert.equal(saveCount, 1);
});

test('user home locality migration repairs the text field limit and rejects incompatible fields', () => {
    const existing = { name: 'homeLocation', max: 120, type() { return 'text'; } };
    const repaired = runMigration(existing);
    assert.equal(existing.max, 80);
    assert.equal(repaired.fields[0], existing);
    assert.equal(repaired.saveCount, 1);
    assert.throws(
        () => runMigration({ name: 'homeLocation', type() { return 'number'; } }),
        /users\.homeLocation must be a text field/
    );
});
