'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const migrationPath = path.join(__dirname, '..', 'pb_migrations', '1794835005_add_author_nicknames.js');

function runMigration({ incompatibleField = null } = {}) {
    let migrateUp;
    const collectionNames = [
        'routes', 'map_pois', 'community_routes', 'community_segments',
        'community_route_ratings', 'community_route_comments',
        'community_route_efforts', 'community_segment_efforts',
        'live_locations', 'mtb_group_members'
    ];
    const collections = new Map(collectionNames.map(name => {
        const fields = [];
        if (incompatibleField && incompatibleField.collection === name) {
            fields.push({
                name: incompatibleField.field,
                type() { return 'number'; }
            });
        }
        return [name, {
            name,
            fields: {
                getByName(fieldName) { return fields.find(field => field.name === fieldName) || null; },
                add(field) { fields.push(field); }
            },
            schemaFields: fields
        }];
    }));
    const rows = new Map(collectionNames.map(name => [name, []]));
    const user = { getString: name => name === 'nickname' ? 'Rider' : '' };
    let saveCount = 0;
    const app = {
        findCollectionByNameOrId(name) {
            const collection = collections.get(name);
            assert.ok(collection, `unknown collection ${name}`);
            return collection;
        },
        findRecordById(collection, id) {
            assert.equal(collection, 'users');
            assert.equal(id, 'user123');
            return user;
        },
        findRecordsByFilter(collection, filter, sort, limit, offset) {
            assert.equal(filter, 'id != ""');
            assert.equal(sort, 'id');
            return rows.get(collection).slice(offset, offset + limit);
        },
        save(value) {
            saveCount++;
            return value;
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

    return { app, collections, rows, migrateUp, get saveCount() { return saveCount; } };
}

function record(values) {
    return {
        ...values,
        getString(name) { return String(this[name] || ''); },
        set(name, value) { this[name] = value; }
    };
}

test('author migration adds attribution fields and backfills current nicknames', () => {
    const migration = runMigration();
    const expected = {
        routes: ['createdBy'],
        map_pois: ['createdBy'],
        community_routes: ['createdBy'],
        community_segments: ['createdBy'],
        community_route_ratings: ['alias'],
        community_route_comments: ['alias'],
        community_route_efforts: ['alias'],
        community_segment_efforts: ['alias'],
        live_locations: ['name'],
        mtb_group_members: ['nickname']
    };

    Object.entries(expected).forEach(([collection, fields]) => {
        fields.forEach(field => migration.rows.get(collection).push(
            record({ id: `${collection}-1`, owner: 'user123', user: 'user123', [field]: 'Old name' })
        ));
    });
    migration.migrateUp(migration.app);

    Object.entries(expected).forEach(([collection, fields]) => {
        const schema = migration.collections.get(collection).schemaFields;
        fields.forEach(field => {
            assert.equal(schema.find(item => item.name === field).type(), 'text');
            assert.equal(migration.rows.get(collection)[0][field], 'Rider');
        });
    });

    const firstSaveCount = migration.saveCount;
    migration.migrateUp(migration.app);
    assert.equal(migration.saveCount, firstSaveCount);
});

test('author migration rejects an incompatible attribution field', () => {
    const migration = runMigration({ incompatibleField: { collection: 'map_pois', field: 'createdBy' } });
    assert.throws(() => migration.migrateUp(migration.app), /map_pois\.createdBy must be a text field/);
});
