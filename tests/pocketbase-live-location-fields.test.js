'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runMigration(existingFields = []) {
    let up;
    let saveCount = 0;
    const fields = existingFields.slice();
    const collection = {
        name: 'live_locations',
        fields: {
            getByName(name) { return fields.find(field => field.name === name) || null; },
            add(field) { fields.push(field); }
        }
    };
    const app = {
        findCollectionByNameOrId(name) {
            assert.equal(name, 'live_locations');
            return collection;
        },
        save(savedCollection) {
            assert.equal(savedCollection, collection);
            saveCount++;
        }
    };
    class FakeAutodateField {
        constructor(definition) {
            Object.assign(this, definition);
            this.fieldType = 'autodate';
        }
        type() { return this.fieldType; }
    }
    const context = vm.createContext({
        AutodateField: FakeAutodateField,
        migrate(callback) { up = callback; }
    });
    vm.runInContext(
        fs.readFileSync(
            path.join(__dirname, '..', 'pb_migrations', '1794835004_add_live_location_timestamps.js'),
            'utf8'
        ),
        context
    );
    up(app);
    return { fields, saveCount };
}

test('live locations migration adds create and update timestamps', () => {
    const { fields, saveCount } = runMigration();
    const byName = new Map(fields.map(field => [field.name, field]));

    assert.equal(byName.get('created').type(), 'autodate');
    assert.equal(byName.get('created').onCreate, true);
    assert.equal(byName.get('created').onUpdate, false);
    assert.equal(byName.get('updated').type(), 'autodate');
    assert.equal(byName.get('updated').onCreate, true);
    assert.equal(byName.get('updated').onUpdate, true);
    assert.equal(saveCount, 1);
});

test('live locations migration preserves compatible timestamp fields', () => {
    const created = {
        name: 'created',
        onCreate: true,
        onUpdate: false,
        type() { return 'autodate'; }
    };
    const updated = {
        name: 'updated',
        onCreate: true,
        onUpdate: true,
        type() { return 'autodate'; }
    };
    const { fields, saveCount } = runMigration([created, updated]);

    assert.equal(fields[0], created);
    assert.equal(fields[1], updated);
    assert.equal(saveCount, 0);
});

test('live locations migration rejects incompatible timestamp field types', () => {
    assert.throws(
        () => runMigration([{ name: 'updated', type() { return 'date'; } }]),
        /live_locations\.updated must be an autodate field/
    );
});
