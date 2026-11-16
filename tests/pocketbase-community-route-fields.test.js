'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runMigration(fields = [], migrationFile = '1794835001_add_community_route_poi_fields.js') {
    let up;
    let saveCount = 0;
    const schema = fields.slice();
    const collection = {
        name: 'community_routes',
        fields: {
            getByName(name) { return schema.find(field => field.name === name) || null; },
            add(field) { schema.push(field); }
        }
    };
    const app = {
        findCollectionByNameOrId(name) {
            assert.equal(name, 'community_routes');
            return collection;
        },
        save(savedCollection) {
            assert.equal(savedCollection, collection);
            saveCount++;
        }
    };
    class FakeTextField {
        constructor(definition) { Object.assign(this, definition); }
        type() { return 'text'; }
    }
    class FakeFileField {
        constructor(definition) { Object.assign(this, definition); }
        type() { return 'file'; }
    }
    const context = vm.createContext({
        TextField: FakeTextField,
        FileField: FakeFileField,
        migrate(callback) { up = callback; }
    });
    vm.runInContext(
        fs.readFileSync(
            path.join(__dirname, '..', 'pb_migrations', migrationFile),
            'utf8'
        ),
        context
    );
    up(app);
    return { schema, saveCount };
}

test('community routes migration adds optional POI JSON and photo fields', () => {
    const { schema, saveCount } = runMigration();
    const byName = new Map(schema.map(field => [field.name, field]));

    assert.equal(byName.get('poisJson').type(), 'text');
    assert.equal(byName.get('poisJson').max, 131072);
    assert.equal(byName.get('poiPhotos').type(), 'file');
    assert.equal(byName.get('poiPhotos').maxSelect, 5);
    assert.equal(byName.get('poiPhotos').maxSize, 614400);
    assert.deepEqual(Array.from(byName.get('poiPhotos').mimeTypes), ['image/jpeg']);
    assert.equal(saveCount, 1);
});

test('community routes migration leaves existing compatible fields intact', () => {
    const existing = [
        { name: 'poisJson', type() { return 'text'; }, max: 1000 },
        { name: 'poiPhotos', type() { return 'file'; }, maxSelect: 1 }
    ];
    const { schema, saveCount } = runMigration(existing);

    assert.equal(schema.length, 2);
    assert.equal(schema[0], existing[0]);
    assert.equal(schema[1], existing[1]);
    assert.equal(saveCount, 0);
});

test('community routes migration refuses incompatible existing field types', () => {
    assert.throws(
        () => runMigration([{ name: 'poisJson', type() { return 'number'; } }]),
        /community_routes\.poisJson must be a text field/
    );
});

test('community routes track migration raises the text limit for existing collections', () => {
    const trackJson = { name: 'trackJson', type() { return 'text'; }, max: 5000 };
    const { schema, saveCount } = runMigration(
        [trackJson],
        '1794835002_expand_community_route_track_json.js'
    );

    assert.equal(schema[0].max, 262144);
    assert.equal(saveCount, 1);
});

test('community routes track migration preserves an existing larger limit', () => {
    const trackJson = { name: 'trackJson', type() { return 'text'; }, max: 300000 };
    const { schema, saveCount } = runMigration(
        [trackJson],
        '1794835002_expand_community_route_track_json.js'
    );

    assert.equal(schema[0].max, 300000);
    assert.equal(saveCount, 0);
});

test('community routes track migration adds a missing optional text field', () => {
    const { schema, saveCount } = runMigration(
        [],
        '1794835002_expand_community_route_track_json.js'
    );

    assert.equal(schema.length, 1);
    assert.equal(schema[0].name, 'trackJson');
    assert.equal(schema[0].type(), 'text');
    assert.equal(schema[0].max, 262144);
    assert.equal(schema[0].required, undefined);
    assert.equal(saveCount, 1);
});

test('community routes track migration refuses an incompatible existing field', () => {
    assert.throws(
        () => runMigration(
            [{ name: 'trackJson', type() { return 'number'; }, max: 5000 }],
            '1794835002_expand_community_route_track_json.js'
        ),
        /community_routes\.trackJson must be a text field/
    );
});
