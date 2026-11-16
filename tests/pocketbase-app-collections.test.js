'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const COLLECTION_NAMES = [
    'routes',
    'map_pois',
    'mtb_groups',
    'mtb_group_members',
    'live_locations',
    'mtb_group_ranking_entries',
    'community_routes',
    'community_segments',
    'community_route_efforts',
    'community_segment_efforts',
    'community_route_favorites',
    'community_route_ratings',
    'community_route_comments'
];

function runMigration(existingNames = []) {
    let up;
    const collections = [];
    class FakeCollection {
        constructor(definition) {
            Object.assign(this, definition);
            const fields = definition.fields || [];
            this.fields = {
                getByName(name) { return fields.find(field => field.name === name) || null; },
                add(field) { fields.push(field); }
            };
        }
    }
    class FakeTextField {
        constructor(definition) { Object.assign(this, { type: 'text' }, definition); }
    }
    const users = new FakeCollection({
        type: 'auth',
        name: 'users',
        id: 'users_collection_id',
        fields: []
    });
    collections.push(users);
    existingNames.forEach(name => collections.push(new FakeCollection({ type: 'base', name, id: `${name}_existing` })));
    const app = {
        findAllCollections() { return collections.slice(); },
        findCollectionByNameOrId(name) {
            const collection = collections.find(item => item.name === name);
            if (!collection) throw new Error(`Missing collection: ${name}`);
            return collection;
        },
        save(collection) {
            if (!collection.id) collection.id = `${collection.name}_id`;
            if (!collections.includes(collection)) collections.push(collection);
        }
    };
    const context = vm.createContext({
        Collection: FakeCollection,
        TextField: FakeTextField,
        migrate(callback) { up = callback; }
    });
    vm.runInContext(
        fs.readFileSync(
            path.join(__dirname, '..', 'pb_migrations', '1794835000_create_mtb_app_collections.js'),
            'utf8'
        ),
        context
    );
    up(app);
    return { collections, users };
}

test('PocketBase setup migration creates the active app collections and keeps routes private', () => {
    const { collections, users } = runMigration();
    const byName = new Map(collections.map(collection => [collection.name, collection]));

    COLLECTION_NAMES.forEach(name => assert.ok(byName.has(name), `missing ${name}`));
    const routes = byName.get('routes');
    assert.equal(routes.listRule, '@request.auth.id != "" && owner = @request.auth.id');
    assert.equal(routes.viewRule, routes.listRule);
    assert.match(routes.updateRule, /@request\.body\.owner:isset = false/);
    assert.match(routes.updateRule, /@request\.body\.owner = @request\.auth\.id/);
    assert.equal(routes.fields.getByName('owner').collectionId, users.id);
    assert.equal(routes.fields.getByName('track').required, true);
    assert.ok(users.fields.getByName('groupCode'));

    const communityRoutes = byName.get('community_routes');
    assert.equal(communityRoutes.fields.getByName('trackJson').required, true);
    assert.equal(communityRoutes.fields.getByName('trackJson').max, 262144);

    const liveLocations = byName.get('live_locations');
    assert.equal(liveLocations.fields.getByName('groupCode').type, 'relation');
    assert.match(liveLocations.listRule, /@collection\.mtb_group_members\.group \?= groupCode/);
    assert.match(liveLocations.createRule, /@collection\.mtb_group_members\.user \?= @request\.auth\.id/);
    assert.match(liveLocations.updateRule, /@request\.body\.groupCode:changed = false/);
});

test('PocketBase setup migration preserves collections that already exist', () => {
    const { collections } = runMigration(['routes']);
    assert.equal(collections.filter(collection => collection.name === 'routes').length, 1);
});
