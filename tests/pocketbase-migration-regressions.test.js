'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadMigration(fileName) {
    let up;
    let down;
    const context = vm.createContext({
        TextField: class {
            constructor(definition) { Object.assign(this, definition); }
            type() { return 'text'; }
        },
        AutodateField: class {
            constructor(definition) { Object.assign(this, definition); }
            type() { return 'autodate'; }
        },
        Collection: class {
            constructor(definition) { Object.assign(this, definition); }
        },
        NumberField: class {
            constructor(definition) { Object.assign(this, definition); }
            type() { return 'number'; }
        },
        migrate(upCallback, downCallback) {
            up = upCallback;
            down = downCallback;
        }
    });
    const file = path.join(__dirname, '..', 'pb_migrations', fileName);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return { up, down };
}

test('sourcePath index migration permits multiple existing empty paths', () => {
    const migration = loadMigration('1794835006_add_community_route_source_path.js');
    const fields = [];
    const collection = {
        indexes: [],
        fields: {
            getByName(name) { return fields.find(field => field.name === name) || null; },
            add(field) { fields.push(field); },
            removeById(id) {
                const index = fields.findIndex(field => field.id === id);
                if (index >= 0) fields.splice(index, 1);
            }
        }
    };
    const app = { findCollectionByNameOrId() { return collection; }, save() {} };

    migration.up(app);

    assert.equal(fields[0].name, 'sourcePath');
    assert.match(collection.indexes[0], /UNIQUE INDEX .* WHERE sourcePath != ''$/);

    migration.down(app);
    assert.equal(fields.length, 0);
    assert.equal(collection.indexes.length, 0);
});

test('challenge migration rollback preserves a collection that existed before migration', () => {
    const migration = loadMigration('1794836000_create_group_challenges.js');
    const fields = [];
    const ranking = {
        name: 'mtb_group_ranking_entries',
        fields: {
            getByName(name) { return fields.find(field => field.name === name) || null; },
            add(field) { fields.push(field); }
        }
    };
    const existingChallenges = { name: 'mtb_group_challenges', records: [{ id: 'existing-challenge' }] };
    const collections = [existingChallenges];
    const deleted = [];
    const app = {
        findCollectionByNameOrId(name) {
            if (name === ranking.name) return ranking;
            return { id: `${name}_id`, name };
        },
        findAllCollections() { return collections; },
        save() {},
        delete(collection) { deleted.push(collection); }
    };

    migration.up(app);
    migration.down(app);

    assert.ok(collections.includes(existingChallenges));
    assert.deepEqual(existingChallenges.records, [{ id: 'existing-challenge' }]);
    assert.deepEqual(deleted, []);
});

test('Strava migration rollback preserves a collection that existed before migration', () => {
    const migration = loadMigration('1794836001_create_strava_connections.js');
    const existingConnections = { name: 'strava_connections', records: [{ id: 'existing-connection' }] };
    const collections = [existingConnections];
    const deleted = [];
    const app = {
        findCollectionByNameOrId(name) {
            if (name === 'users') return { id: 'users_id' };
            if (name === 'strava_connections') return existingConnections;
            throw new Error(`Unknown collection: ${name}`);
        },
        findAllCollections() { return collections; },
        save() {},
        delete(collection) { deleted.push(collection); }
    };

    migration.up(app);
    migration.down(app);

    assert.ok(collections.includes(existingConnections));
    assert.deepEqual(existingConnections.records, [{ id: 'existing-connection' }]);
    assert.deepEqual(deleted, []);
});
