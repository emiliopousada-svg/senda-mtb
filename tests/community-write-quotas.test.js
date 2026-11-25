'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadMigration() {
    let up;
    let down;
    const fields = [];
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
    const file = path.join(root, 'pb_migrations', '1794836015_enforce_community_write_quotas.js');
    const context = vm.createContext({
        BoolField: class {
            constructor(definition) { Object.assign(this, definition); }
        },
        migrate(upCallback, downCallback) {
            up = upCallback;
            down = downCallback;
        }
    });
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return { up, down, collection, fields };
}

function loadQuotaUtils() {
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        DynamicModel: class {
            constructor(defaults) { Object.assign(this, defaults); }
        },
        module: { exports: {} }
    });
    const file = path.join(root, 'pb_hooks', 'community_quota_utils.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return context.module.exports;
}

test('community quota migration installs atomic daily and hourly guards and can roll back', () => {
    const migration = loadMigration();
    const queries = [];
    const app = {
        findCollectionByNameOrId(name) {
            assert.equal(name, 'community_routes');
            return migration.collection;
        },
        save(value) { assert.equal(value, migration.collection); },
        db() {
            return {
                newQuery(query) {
                    return { execute() { queries.push(query); } };
                }
            };
        }
    };

    migration.up(app);

    const sql = queries.join('\n');
    assert.equal(migration.fields[0].name, 'quotaExemptForLimit');
    assert.equal(migration.fields[0].hidden, true);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS mtb_community_write_quota_events/);
    assert.match(sql, /community_route_comments[\s\S]*quota = 'social'[\s\S]*\) >= 10/);
    assert.match(sql, /community_route_ratings[\s\S]*quota = 'social'[\s\S]*\) >= 10/);
    assert.match(sql, /community_routes[\s\S]*NEW\.published = 1 AND NEW\.quotaExemptForLimit IS NOT 1[\s\S]*quota = 'route'[\s\S]*\) >= 5/);
    assert.match(sql, /UPDATE OF published[\s\S]*OLD\.published IS NOT 1 AND NEW\.published = 1/);
    assert.match(sql, /mtb_groups[\s\S]*quota = 'group'[\s\S]*\) >= 1/);
    assert.match(sql, /AFTER DELETE ON users[\s\S]*WHERE owner = OLD\.id/);
    assert.match(sql, /RAISE\(ABORT/);

    migration.down(app);
    assert.match(queries.at(-1), /DROP TABLE IF EXISTS mtb_community_write_quota_events/);
    assert.equal(queries.filter(query => /DROP TRIGGER IF EXISTS/.test(query)).length, 6);
    assert.equal(migration.fields.length, 0);
});

test('community quota helper uses bound values and reports an explicit limit error', () => {
    const { COMMUNITY_WRITE_QUOTAS, enforceCommunityWriteQuota } = loadQuotaUtils();
    let queryText = '';
    let bindings;
    const app = {
        db() {
            return {
                newQuery(query) {
                    queryText = query;
                    return {
                        bind(values) {
                            bindings = values;
                            return this;
                        },
                        one(result) { result.total = 10; }
                    };
                }
            };
        }
    };

    assert.equal(COMMUNITY_WRITE_QUOTAS.social.max, 10);
    assert.throws(
        () => enforceCommunityWriteQuota(app, 'user-1', 'social'),
        /límite de 10 comentarios o valoraciones por hora/
    );
    assert.match(queryText, /owner = \{:owner\}/);
    assert.equal(bindings.owner, 'user-1');
    assert.equal(bindings.quota, 'social');
    assert.equal(bindings.windowSeconds, 3600);
});

test('social create hook applies one shared quota to comments and ratings', () => {
    let createHandler;
    let checkedQuota = '';
    let nextCalled = false;
    const context = vm.createContext({
        BadRequestError: class BadRequestError extends Error {},
        __hooks: 'hooks',
        $app: {
            findRecordById() {
                return { getString: () => 'Rider' };
            }
        },
        require(name) {
            assert.equal(name, 'hooks/community_quota_utils.js');
            return {
                enforceCommunityWriteQuota(_app, owner, quota) {
                    assert.equal(owner, 'user-1');
                    checkedQuota = quota;
                }
            };
        },
        onRecordCreateRequest(handler, ...collections) {
            assert.deepEqual(collections, ['community_route_comments', 'community_route_ratings']);
            createHandler = handler;
        },
        onRecordUpdateRequest() {}
    });
    const file = path.join(root, 'pb_hooks', 'community_social.pb.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

    createHandler({
        hasSuperuserAuth: () => false,
        auth: { id: 'user-1' },
        record: {
            isNew: () => true,
            getString(name) { return name === 'owner' ? 'user-1' : ''; },
            set() {}
        },
        next() { nextCalled = true; }
    });

    assert.equal(checkedQuota, 'social');
    assert.equal(nextCalled, true);
});

test('community quota cleanup removes events older than the daily window', () => {
    let registered;
    let executedQuery = '';
    const context = vm.createContext({
        cronAdd(name, schedule, callback) { registered = { name, schedule, callback }; },
        $app: {
            db() {
                return {
                    newQuery(query) {
                        executedQuery = query;
                        return { execute() {} };
                    }
                };
            }
        }
    });
    const file = path.join(root, 'pb_hooks', 'community_quota_cleanup.pb.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

    assert.equal(registered.name, 'limpiar_cuotas_comunitarias');
    assert.equal(registered.schedule, '*/15 * * * *');
    registered.callback();
    assert.match(executedQuery, /DELETE FROM mtb_community_write_quota_events/);
    assert.match(executedQuery, /created_at <[\s\S]*- 86400/);
});
