'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const cloudSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud.js'), 'utf8');
const authStart = cloudSource.indexOf('async function accAuth(register) {');
const authEnd = cloudSource.indexOf('\nasync function saveAccountNickname()', authStart);
assert.ok(authStart >= 0 && authEnd > authStart, 'accAuth must remain available for focused tests');
const authSource = cloudSource.slice(authStart, authEnd);

function createAuthContext(cloudApi) {
    const stored = new Map([
        ['mtb_pro_server', 'https://mtbpro.ddns.net'],
        ['mtb_pro_token', 'previous-token'],
        ['mtb_pro_uid', 'previous-user']
    ]);
    const state = { token: 'previous-token', uid: 'previous-user', nickname: '', clearCalls: 0 };
    const elements = new Map([
        ['acc-nickname', { value: '' }],
        ['acc-email', { value: 'rider@example.com' }],
        ['acc-pass', { value: 'password' }],
        ['acc-weight', { value: '' }],
        ['acc-age', { value: '' }],
        ['acc-account-nickname', { value: '' }]
    ]);
    const messages = [];
    const events = [];
    const localStorage = {
        getItem(key) { return stored.has(key) ? stored.get(key) : null; },
        setItem(key, value) { stored.set(key, String(value)); },
        removeItem(key) { stored.delete(key); }
    };
    const Cloud = {
        server: 'https://mtbpro.ddns.net',
        get token() { return state.token; },
        get uid() { return state.uid; },
        get nickname() { return state.nickname; },
        loggedIn() { return Boolean(state.token && state.uid); },
        clearSession() {
            state.clearCalls++;
            state.token = '';
            state.uid = '';
            state.nickname = '';
        },
        setSession(token, record) {
            state.token = token;
            state.uid = record.id;
            state.nickname = record.nickname || '';
        }
    };
    const context = vm.createContext({
        Cloud,
        ROUTE_NICKNAME_LIMIT: 32,
        localStorage,
        $: id => elements.get(id) || { value: '' },
        cloudApi,
        renderAccountProfile() {},
        syncPendingAccountAvatar: async () => {},
        renderAccount() { events.push('renderAccount'); },
        syncCloudPreferences: async () => {},
        restoreGroup: async () => {},
        syncRoutes() {},
        syncSharedPois: async () => true,
        pendingSharedPoiCount: () => 0,
        poiSyncPendingMessage: () => '',
        toast: message => messages.push(message),
        console: { warn() {} }
    });
    vm.runInContext(authSource, context);
    return { context, state, elements, messages, events, stored };
}

test('failed login preserves the current session until credentials are accepted', async () => {
    const { context, state, stored } = createAuthContext(async () => {
        const error = new Error('invalid login credentials');
        error.status = 400;
        throw error;
    });

    await context.accAuth(false);

    assert.equal(state.clearCalls, 0);
    assert.equal(state.token, 'previous-token');
    assert.equal(state.uid, 'previous-user');
    assert.equal(stored.get('mtb_pro_token'), 'previous-token');
});

test('post-login sync failures do not turn an accepted login into a login failure', async () => {
    const { context, state, messages, events } = createAuthContext(async () => ({
        token: 'new-token',
        record: { id: 'new-user', email: 'rider@example.com', nickname: 'Rider' }
    }));
    context.syncCloudPreferences = async () => { events.push('preferences'); throw new Error('missing preferences collection'); };
    context.restoreGroup = async () => { events.push('group'); throw new Error('missing groups collection'); };
    context.syncSharedPois = async () => { events.push('pois'); throw new Error('missing POI collection'); };

    await context.accAuth(false);

    assert.equal(state.token, 'new-token');
    assert.equal(state.uid, 'new-user');
    assert.equal(state.clearCalls, 0);
    assert.ok(events.indexOf('renderAccount') < events.indexOf('preferences'));
    assert.ok(messages.includes('✅ Sesión iniciada'));
    assert.ok(!messages.some(message => message.includes('No se pudo entrar')));
});
