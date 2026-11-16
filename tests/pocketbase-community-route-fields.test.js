'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runMigration(fields = []) {
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
        constructor(definition) { Object.assign(this, { type: 'text' }, definition); }
    }
    class FakeFileField {
        constructor(definition) { Object.assign(this, { type: 'file' }, definition); }
    }
    const context = vm.createContext({
        TextField: FakeTextField,
        FileField: FakeFileField,
        migrate(callback) { up = callback; }
    });
    vm.runInContext(
        fs.readFileSync(
            path.join(__dirname, '..', 'pb_migrations', '1794835001_add_community_route_poi_fields.js'),
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

    assert.equal(byName.get('poisJson').type, 'text');
    assert.equal(byName.get('poisJson').max, 131072);
    assert.equal(byName.get('poiPhotos').type, 'file');
    assert.equal(byName.get('poiPhotos').maxSelect, 5);
    assert.equal(byName.get('poiPhotos').maxSize, 614400);
    assert.deepEqual(Array.from(byName.get('poiPhotos').mimeTypes), ['image/jpeg']);
    assert.equal(saveCount, 1);
});

test('community routes migration leaves existing compatible fields intact', () => {
    const existing = [
        { name: 'poisJson', type: 'text', max: 1000 },
        { name: 'poiPhotos', type: 'file', maxSelect: 1 }
    ];
    const { schema, saveCount } = runMigration(existing);

    assert.equal(schema.length, 2);
    assert.equal(schema[0], existing[0]);
    assert.equal(schema[1], existing[1]);
    assert.equal(saveCount, 0);
});

test('community routes migration refuses incompatible existing field types', () => {
    assert.throws(
        () => runMigration([{ name: 'poisJson', type: 'number' }]),
        /community_routes\.poisJson must be a text field/
    );
});
