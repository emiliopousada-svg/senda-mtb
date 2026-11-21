'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeField {
    constructor(definition) {
        Object.assign(this, definition);
        this._type = definition.type;
        delete this.type;
    }
    type() { return this._type; }
}

class FakeFields {
    constructor(fields = []) { this.values = fields.map(field => new FakeField(field)); }
    getByName(name) { return this.values.find(field => field.name === name) || null; }
    add(field) { this.values.push(field); }
}

class FakeCollection {
    constructor(definition) {
        Object.assign(this, definition);
        this.fields = new FakeFields(definition.fields);
        this.indexes = [...definition.indexes];
    }
}

function runMigration(existingCollections = []) {
    let up;
    let down;
    const users = {
        name: 'users',
        id: 'users-id',
        authToken: { duration: 432000 },
        passwordResetToken: { duration: 86400 }
    };
    const userRecord = {
        id: 'user-1',
        refreshCount: 0,
        refreshTokenKey() { this.refreshCount += 1; }
    };
    const collections = [users, ...existingCollections];
    const app = {
        findAllCollections() { return collections; },
        findCollectionByNameOrId(name) {
            const collection = collections.find(item => item.name === name);
            if (!collection) throw new Error(`Unknown collection ${name}`);
            return collection;
        },
        findRecordsByFilter(name, _filter, _sort, limit, offset) {
            assert.equal(name, 'users');
            return [userRecord].slice(offset, offset + limit);
        },
        save(value) {
            if (!collections.includes(value)) collections.push(value);
        },
        delete(value) {
            const index = collections.indexOf(value);
            if (index >= 0) collections.splice(index, 1);
        }
    };
    const context = vm.createContext({
        BoolField: FakeField,
        Collection: FakeCollection,
        NumberField: FakeField,
        RelationField: FakeField,
        TextField: FakeField,
        migrate(upCallback, downCallback) {
            up = upCallback;
            down = downCallback;
        }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'pb_migrations', '1794836005_create_revocable_auth_sessions.js'), 'utf8'),
        context
    );
    up(app);
    return { app, collections, down, userRecord, users };
}

test('auth migration creates closed collections and bounds JWT and reset token lifetimes', () => {
    const { collections, userRecord, users } = runMigration();
    const sessions = collections.find(collection => collection.name === 'mtb_auth_sessions');
    const limits = collections.find(collection => collection.name === 'mtb_auth_rate_limits');

    assert.ok(sessions);
    assert.ok(limits);
    for (const collection of [sessions, limits]) {
        assert.equal(collection.listRule, null);
        assert.equal(collection.viewRule, null);
        assert.equal(collection.createRule, null);
        assert.equal(collection.updateRule, null);
        assert.equal(collection.deleteRule, null);
    }
    assert.deepEqual(
        Array.from(sessions.fields.values, field => field.name),
        ['owner', 'tokenHash', 'sourceTokenHash', 'expiresAt', 'revoked']
    );
    assert.equal(sessions.fields.getByName('revoked').required, false);
    assert.ok(sessions.indexes.some(index => index.includes('sourceTokenHash')));
    assert.equal(limits.fields.getByName('blockedUntil').required, false);
    assert.equal(limits.fields.getByName('pendingAttemptCount').required, false);
    assert.equal(limits.fields.getByName('attemptCount').required, false);
    assert.equal(users.authToken.duration, 120);
    assert.equal(users.passwordResetToken.duration, 1800);
    assert.equal(userRecord.refreshCount, 1);
});

test('auth migration adopts quoted indexes without duplicating them and relaxes zero-valued counters', () => {
    const initial = runMigration();
    const sessions = initial.collections.find(collection => collection.name === 'mtb_auth_sessions');
    const limits = initial.collections.find(collection => collection.name === 'mtb_auth_rate_limits');
    sessions.indexes[0] = 'CREATE UNIQUE INDEX "idx_mtb_auth_sessions_token_hash" ON "mtb_auth_sessions" ("tokenHash")';
    limits.fields.getByName('attemptCount').required = true;
    limits.fields.getByName('pendingAttemptCount').required = true;

    const migrated = runMigration([sessions, limits]);
    const updatedSessions = migrated.collections.find(collection => collection.name === 'mtb_auth_sessions');
    const updatedLimits = migrated.collections.find(collection => collection.name === 'mtb_auth_rate_limits');

    assert.equal(updatedSessions.indexes.length, 3);
    assert.equal(updatedLimits.indexes.length, 2);
    assert.equal(updatedLimits.fields.getByName('attemptCount').required, false);
    assert.equal(updatedLimits.fields.getByName('pendingAttemptCount').required, false);
});

test('auth migration expands the expiry range to keep future session timestamps valid', () => {
    const initial = runMigration();
    const sessions = initial.collections.find(collection => collection.name === 'mtb_auth_sessions');
    const limits = initial.collections.find(collection => collection.name === 'mtb_auth_rate_limits');
    sessions.fields.getByName('expiresAt').max = 2147483647;
    sessions.fields.getByName('expiresAt').min = 100;

    const migrated = runMigration([sessions, limits]);
    const expiry = migrated.collections.find(collection => collection.name === 'mtb_auth_sessions')
        .fields.getByName('expiresAt');

    assert.equal(expiry.max, Number.MAX_SAFE_INTEGER);
    assert.equal(expiry.min, 0);
});

test('auth migration downgrade retains collections that may contain pre-existing session data', () => {
    const { app, collections, down } = runMigration();

    down(app);

    assert.ok(collections.some(collection => collection.name === 'mtb_auth_sessions'));
    assert.ok(collections.some(collection => collection.name === 'mtb_auth_rate_limits'));
});
