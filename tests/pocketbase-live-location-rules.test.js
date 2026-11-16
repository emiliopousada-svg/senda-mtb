'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runMigration(initialRules = {}) {
    let up;
    let saveCount = 0;
    const groupCode = { name: 'groupCode', type: 'relation' };
    const collection = {
        name: 'live_locations',
        listRule: initialRules.listRule ?? null,
        viewRule: initialRules.viewRule ?? null,
        createRule: initialRules.createRule ?? null,
        updateRule: initialRules.updateRule ?? null,
        deleteRule: initialRules.deleteRule ?? null,
        fields: {
            getByName(name) { return name === 'groupCode' ? groupCode : null; }
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
    const context = vm.createContext({
        migrate(callback) { up = callback; }
    });
    vm.runInContext(
        fs.readFileSync(
            path.join(__dirname, '..', 'pb_migrations', '1794835003_secure_live_location_access.js'),
            'utf8'
        ),
        context
    );
    up(app);
    return { collection, groupCode, saveCount };
}

test('live location rules require current group membership for read and write', () => {
    const { collection, groupCode, saveCount } = runMigration();

    assert.equal(collection.listRule, collection.viewRule);
    assert.match(collection.listRule, /@request\.auth\.groupCode != ""/);
    assert.match(collection.listRule, /@collection\.mtb_group_members\.group \?= groupCode/);
    assert.match(collection.listRule, /@collection\.mtb_group_members\.user \?= @request\.auth\.id/);
    assert.match(collection.createRule, /@request\.body\.owner = @request\.auth\.id/);
    assert.match(collection.createRule, /@collection\.mtb_group_members\.group \?= @request\.body\.groupCode/);
    assert.match(collection.updateRule, /@request\.body\.owner:changed = false/);
    assert.match(collection.updateRule, /@request\.body\.groupCode:changed = false/);
    assert.equal(collection.deleteRule, '@request.auth.id != "" && owner = @request.auth.id');
    assert.equal(collection.fields.getByName('groupCode'), groupCode);
    assert.equal(saveCount, 1);
});

test('live location rules migration is idempotent', () => {
    const { collection, saveCount } = runMigration();
    const rules = {
        listRule: collection.listRule,
        viewRule: collection.viewRule,
        createRule: collection.createRule,
        updateRule: collection.updateRule,
        deleteRule: collection.deleteRule
    };

    const secondRun = runMigration(rules);

    assert.equal(secondRun.saveCount, 0);
});
