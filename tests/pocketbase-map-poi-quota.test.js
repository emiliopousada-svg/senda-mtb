'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadMigration() {
    let up;
    let down;
    const file = path.join(__dirname, '..', 'pb_migrations', '1794836009_enforce_map_poi_owner_limit.js');
    const context = vm.createContext({
        BoolField: class {
            constructor(definition) { Object.assign(this, definition); }
            type() { return 'bool'; }
        },
        migrate(upCallback, downCallback) {
            up = upCallback;
            down = downCallback;
        }
    });
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return { up, down };
}

function createMigrationApp(existingField = null) {
    const fields = existingField ? [existingField] : [];
    const queries = [];
    let saveCount = 0;
    const collection = {
        fields: {
            getByName(name) { return fields.find(field => field.name === name) || null; },
            add(field) { fields.push(field); },
            removeByName(name) {
                const index = fields.findIndex(field => field.name === name);
                if (index >= 0) fields.splice(index, 1);
            }
        }
    };
    const app = {
        findCollectionByNameOrId(name) {
            assert.equal(name, 'map_pois');
            return collection;
        },
        db() {
            return {
                newQuery(query) {
                    return { execute() { queries.push(query); } };
                }
            };
        },
        save(value) {
            assert.equal(value, collection);
            saveCount++;
        }
    };
    return { app, fields, queries, get saveCount() { return saveCount; } };
}

test('POI quota migration installs an atomic insert trigger and rolls it back', () => {
    const migration = loadMigration();
    const state = createMigrationApp();

    migration.up(state.app);

    assert.equal(state.fields[0].name, 'quotaExemptForLimit');
    assert.equal(state.fields[0].hidden, true);
    assert.match(state.queries[0], /BEFORE INSERT ON map_pois/);
    assert.match(state.queries[0], /NEW\.quotaExemptForLimit IS NOT 1/);
    assert.match(state.queries[0], /COUNT\(\*\).*owner = NEW\.owner/s);
    assert.match(state.queries[0], />= 500/);

    migration.down(state.app);

    assert.equal(state.queries[1], 'DROP TRIGGER IF EXISTS map_pois_owner_limit_guard');
    assert.equal(state.fields.length, 0);
    assert.equal(state.saveCount, 2);
});

test('POI quota migration rejects a pre-existing internal field', () => {
    const migration = loadMigration();
    const state = createMigrationApp({
        name: 'quotaExemptForLimit',
        hidden: true,
        type() { return 'text'; }
    });

    assert.throws(() => migration.up(state.app), /quotaExemptForLimit already exists/);
    assert.equal(state.queries.length, 0);
});
