'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('la migración añade fechas al ranking y crea mtb_group_challenges una sola vez', () => {
    let up;
    const fields = [];
    const saved = [];
    const collections = [];
    const ranking = {
        name: 'mtb_group_ranking_entries',
        fields: { getByName: name => fields.find(field => field.name === name) || null, add: field => fields.push(field) }
    };
    const app = {
        findCollectionByNameOrId(name) {
            if (name === 'mtb_group_ranking_entries') return ranking;
            return { id: name + '_id', name };
        },
        findAllCollections: () => collections,
        save(collection) { saved.push(collection); if (collection.name === 'mtb_group_challenges') collections.push(collection); }
    };
    class AutodateField { constructor(definition) { Object.assign(this, definition); } type() { return 'autodate'; } }
    class Collection { constructor(definition) { Object.assign(this, definition); } }
    const context = vm.createContext({ AutodateField, Collection, migrate(callback) { up = callback; } });
    const file = path.join(__dirname, '..', 'pb_migrations', '1794836000_create_group_challenges.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

    up(app);
    assert.deepEqual(fields.map(field => field.name), ['created', 'updated']);
    const challenges = collections.find(collection => collection.name === 'mtb_group_challenges');
    assert.ok(challenges);
    assert.equal(challenges.listRule, null);
    assert.deepEqual(Array.from(challenges.fields, field => field.name), ['group', 'createdBy', 'name', 'metric', 'target', 'startsAt', 'endsAt', 'created', 'updated']);

    const savesAfterFirstRun = saved.length;
    up(app);
    assert.equal(saved.length, savesAfterFirstRun, 'la segunda ejecución no cambia nada');
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'pb_migrations', 'PENDING_1794836000_create_competition_collections.js')));
});
