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
        BoolField: class {
            constructor(definition) { Object.assign(this, definition); }
            type() { return 'bool'; }
        },
        RelationField: class {
            constructor(definition) { Object.assign(this, definition); }
            type() { return 'relation'; }
        },
        DateField: class {
            constructor(definition) { Object.assign(this, definition); }
            type() { return 'date'; }
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

test('group ranking migration adds route binding and trusted activity date idempotently', () => {
    const migration = loadMigration('1794836012_bind_group_rankings_to_verified_routes.js');
    const fields = [];
    const ranking = {
        name: 'mtb_group_ranking_entries',
        fields: {
            getByName(name) { return fields.find(field => field.name === name) || null; },
            add(field) {
                field.id = field.name;
                fields.push(field);
            },
            removeById(id) {
                const index = fields.findIndex(field => field.id === id);
                if (index >= 0) fields.splice(index, 1);
            }
        }
    };
    const routes = { name: 'routes', id: 'routes-id' };
    let saves = 0;
    const app = {
        findCollectionByNameOrId(name) {
            if (name === ranking.name) return ranking;
            if (name === routes.name) return routes;
            throw new Error(`Unexpected collection: ${name}`);
        },
        save() { saves++; }
    };

    migration.up(app);
    migration.up(app);

    assert.equal(fields.length, 2);
    assert.equal(fields.find(field => field.name === 'route').collectionId, routes.id);
    assert.equal(fields.find(field => field.name === 'route').cascadeDelete, true);
    assert.equal(fields.find(field => field.name === 'routeSyncedAt').type(), 'date');
    assert.equal(saves, 1);
});

test('community route metrics migration recalculates distance and clears unverified fields', () => {
    const migration = loadMigration('1794836013_recalculate_community_route_metrics.js');
    const records = [
        {
            id: 'user-route',
            values: {
                trackJson: JSON.stringify([[[0, 0], [0, 0.01]]]),
                distanceKm: 42.3,
                elevationGain: 500,
                movingTimeSec: 7200,
                sourcePath: '',
                owner: 'user123'
            },
            getString(name) { return this.values[name] || ''; },
            get(name) { return this.values[name]; },
            set(name, value) { this.values[name] = value; }
        },
        {
            id: 'official-route',
            values: {
                trackJson: JSON.stringify([[[0, 0], [0, 0.01, 20]]]),
                distanceKm: 99,
                elevationGain: 120,
                movingTimeSec: 3600,
                sourcePath: 'galicia/routes/example.gpx',
                owner: 'official'
            },
            getString(name) { return this.values[name] || ''; },
            get(name) { return this.values[name]; },
            set(name, value) { this.values[name] = value; }
        },
        {
            id: 'spoofed-source-route',
            values: {
                trackJson: JSON.stringify([[[0, 0], [0, 0.01]]]),
                distanceKm: 99,
                elevationGain: 600,
                movingTimeSec: 3600,
                sourcePath: 'galicia/routes/forged.gpx',
                owner: 'user123'
            },
            getString(name) { return this.values[name] || ''; },
            get(name) { return this.values[name]; },
            set(name, value) { this.values[name] = value; }
        }
    ];
    let saved = 0;
    const app = {
        findRecordById(collection, id) {
            assert.equal(collection, 'users');
            return { getString: name => name === 'nickname' && id === 'official' ? 'SENDA-MTB' : 'Rider' };
        },
        findRecordsByFilter(collection, filter, sort, limit, offset) {
            assert.equal(collection, 'community_routes');
            assert.equal(filter, 'id != ""');
            assert.equal(sort, 'id');
            assert.equal(limit, 200);
            return offset === 0 ? records : [];
        },
        save() { saved++; }
    };

    migration.up(app);

    for (const record of records) {
        assert.ok(record.values.distanceKm > 1.1 && record.values.distanceKm < 1.12);
        assert.equal(record.values.movingTimeSec, 0);
    }
    assert.equal(records[0].values.elevationGain, 0);
    assert.equal(records[1].values.elevationGain, 120);
    assert.equal(records[2].values.elevationGain, 0);
    assert.equal(saved, 3);
});

test('community route access migration requires an account and restores prior rules on rollback', () => {
    const migration = loadMigration('1794836010_require_auth_for_community_routes.js');
    const previousRules = {
        community_routes: 'published = true',
        community_segments: 'route.published = true',
        community_route_efforts: 'route.published = true',
        community_segment_efforts: 'segment.route.published = true',
        community_route_ratings: 'route.published = true',
        community_route_comments: 'route.published = true'
    };
    const collections = new Map(Object.entries(previousRules).map(([name, rule]) => [
        name, { name, listRule: rule, viewRule: rule }
    ]));
    const app = {
        findCollectionByNameOrId(name) {
            const collection = collections.get(name);
            if (!collection) throw new Error(`Missing collection: ${name}`);
            return collection;
        },
        save() {}
    };

    migration.up(app);

    for (const [name, collection] of collections) {
        assert.match(collection.listRule, /^@request\.auth\.id != "" && /, name);
        assert.equal(collection.viewRule, collection.listRule, name);
    }

    migration.down(app);

    for (const [name, collection] of collections) {
        assert.equal(collection.listRule, previousRules[name], name);
        assert.equal(collection.viewRule, previousRules[name], name);
    }
});

test('published community route track migration creates a hidden persistent lock', () => {
    const migration = loadMigration('1794836014_lock_published_community_route_tracks.js');
    const fields = [];
    const collection = {
        fields: {
            getByName(name) { return fields.find(field => field.name === name) || null; },
            add(field) {
                field.id = field.name;
                fields.push(field);
            },
            removeById(id) {
                const index = fields.findIndex(field => field.id === id);
                if (index >= 0) fields.splice(index, 1);
            }
        }
    };
    const records = [
        {
            id: 'existing-route',
            locked: false,
            getBool(name) { return name === 'trackLocked' && this.locked; },
            set(name, value) { if (name === 'trackLocked') this.locked = value; }
        }
    ];
    let collectionSaves = 0;
    let recordSaves = 0;
    const app = {
        findCollectionByNameOrId(name) {
            assert.equal(name, 'community_routes');
            return collection;
        },
        findRecordsByFilter(name, filter, sort, limit, offset) {
            assert.equal(name, 'community_routes');
            assert.equal(filter, 'id != ""');
            return offset === 0 ? records : [];
        },
        save(value) {
            if (value === collection) collectionSaves++;
            else recordSaves++;
        }
    };

    migration.up(app);

    assert.equal(fields.length, 1);
    assert.equal(fields[0].name, 'trackLocked');
    assert.equal(fields[0].hidden, true);
    assert.equal(records[0].locked, true);
    assert.equal(collectionSaves, 1);
    assert.equal(recordSaves, 1);

    migration.down(app);
    assert.equal(fields.length, 0);
    assert.equal(collectionSaves, 2);
});

