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

