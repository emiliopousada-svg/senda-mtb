'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const cloudSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
    const start = cloudSource.indexOf(startMarker);
    const end = cloudSource.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
    assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
    return cloudSource.slice(start, end);
}

function cloudContext(cloudApi = async () => ({ record: { id: 'user-1' } })) {
    const values = new Map([['mtb_pro_server', 'https://server.example']]);
    const context = vm.createContext({
        APP_CONFIG: {},
        DEFAULT_CLOUD_SERVER: 'https://server.example',
        ROUTE_NICKNAME_LIMIT: 32,
        cancelCloudSyncRetry() {},
        cancelCloudPreferencesSync() {},
        cloudApi,
        dashboardUpdateGreeting() {},
        localStorage: {
            getItem(key) { return values.get(key) || null; },
            setItem(key, value) { values.set(key, String(value)); },
            removeItem(key) { values.delete(key); }
        },
        normalizeServer(value) { return new URL(value).origin; },
        renderAccountAvatar() {},
        resetAccountProfileCache() {}
    });
    const start = cloudSource.indexOf('const Cloud = {');
    const end = cloudSource.indexOf('\n};', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(`${cloudSource.slice(start, end + 3)}\nglobalThis.Cloud = Cloud;`, context);
    return { context, values };
}

function routeSyncContext({ routes = [], remote = [], deleteRoute, putLocal, fetchRemoteRoutes } = {}) {
    const cloud = {
        active: true,
        uid: 'user-a',
        server: 'https://server.example',
        nickname: 'Rider',
        groupCode: '',
        authGeneration: 1,
        loggedIn() { return this.active; },
        async refreshSession() { return { id: this.uid }; }
    };
    const context = vm.createContext({
        ACTIVITY_TYPES: { mtb: 'MTB' },
        AbortController,
        CLOUD_SYNC_RETRY_INITIAL_MS: 5000,
        Cloud: cloud,
        DB: {
            async kvGet() { return []; },
            async kvSet() {},
            async deleteRoute(...args) {
                if (deleteRoute) return deleteRoute(...args);
            }
        },
        ROUTE_FULL_AUDIT_INTERVAL_MS: 24 * 60 * 60 * 1000,
        ROUTE_NICKNAME_LIMIT: 32,
        clearCloudSyncRetryTimer() {},
        cloudSyncStorageKey() { return 'sync-state'; },
        cloudApi: async () => ({ token: 'file-token' }),
        fetch: async () => ({
            ok: true,
            async text() { return JSON.stringify([[0, 0], [1, 1]]); }
        }),
        fetchRemoteRoutes: fetchRemoteRoutes || (async () => ({ records: remote, fullAudit: true })),
        garageRoutesChanged() { return true; },
        isRetryableCloudStatus: () => false,
        localStorage: { getItem() { return null; }, setItem() {} },
        navigator: { onLine: true },
        normalizeRemoteTrack: () => [[0, 0], [1, 1]],
        renderAccount() {},
        renderAccountProfile() {},
        renderSavedRoutes() {},
        refreshStats() {},
        setTimeout,
        clearTimeout,
        syncPendingGroupRankingDeletes: async () => true,
        $: () => ({ textContent: '' }),
        console: { warn() {} },
        async putLocal(route) {
            if (putLocal) return putLocal(route);
        }
    });
    vm.runInContext(
        `let savedRoutes = [];
        let syncing = false, syncQueued = false, syncQueuedManual = false;
        let syncQueuedUid = '', syncQueuedServer = '', syncQueuedAuthGeneration = -1;
        let cloudSyncRetryDelayMs = CLOUD_SYNC_RETRY_INITIAL_MS;
        let cloudSyncRetryGeneration = 0;
        globalThis.setSavedRoutes = routes => { savedRoutes = routes; };
        globalThis.getSavedRoutes = () => savedRoutes.slice();
        ${sourceBetween('async function syncRoutes(', '\nfunction initSettings(')}
        globalThis.syncRoutes = syncRoutes;`,
        context
    );
    context.setSavedRoutes(routes);
    return { context, cloud };
}

test('stale session restoration cannot replace a newer login', async () => {
    let rejectRequest;
    const { context } = cloudContext(() => new Promise((_resolve, reject) => {
        rejectRequest = reject;
    }));
    const restoring = context.Cloud.restoreSession();

    context.Cloud.setSession({ id: 'new-user' });
    rejectRequest(Object.assign(new Error('expired session'), { status: 401 }));

    assert.equal(await restoring, null);
    assert.equal(context.Cloud.loggedIn(), true);
    assert.equal(context.Cloud.uid, 'new-user');
});

test('changing servers invalidates an in-flight session restoration', async () => {
    let resolveRequest;
    const { context } = cloudContext(() => new Promise(resolve => {
        resolveRequest = resolve;
    }));
    const restoring = context.Cloud.restoreSession();

    context.Cloud.setServer('https://other.example');
    resolveRequest({ record: { id: 'old-server-user' } });

    assert.equal(await restoring, null);
    assert.equal(context.Cloud.loggedIn(), false);
    assert.equal(context.Cloud.uid, '');
});

test('switching servers revokes the old cookie session before changing the origin', async () => {
    const calls = [];
    const { context } = cloudContext(async (requestPath, method, body, options) => {
        calls.push({ requestPath, method, server: options.server });
        return {};
    });
    context.Cloud.setServer('https://same.example:9443');
    context.Cloud.setSession({ id: 'user-a' });

    const nextServer = await context.Cloud.switchServer('https://same.example:9444');

    assert.equal(nextServer, 'https://same.example:9444');
    assert.deepEqual(calls, [{
        requestPath: '/api/mtb/auth/logout',
        method: 'POST',
        server: 'https://same.example:9443'
    }]);
    assert.equal(context.Cloud.server, 'https://same.example:9444');
    assert.equal(context.Cloud.loggedIn(), false);
});

test('a failed old-server logout prevents switching to a same-host port', async () => {
    const { context } = cloudContext(async () => {
        throw Object.assign(new Error('old server unavailable'), { status: 503 });
    });
    context.Cloud.setServer('https://same.example:9443');
    context.Cloud.setSession({ id: 'user-a' });

    await assert.rejects(context.Cloud.switchServer('https://same.example:9444'), /old server unavailable/);

    assert.equal(context.Cloud.server, 'https://same.example:9443');
    assert.equal(context.Cloud.loggedIn(), true);
});

test('refreshing a session cannot apply a response from a changed server', async () => {
    let resolveRequest;
    const { context } = cloudContext(() => new Promise(resolve => {
        resolveRequest = resolve;
    }));
    context.Cloud.setSession({ id: 'user-a' });
    const refreshing = context.Cloud.refreshSession();

    context.Cloud.clearSession();
    context.Cloud.setServer('https://other.example');
    resolveRequest({ record: { id: 'user-a' } });

    assert.equal(await refreshing, null);
    assert.equal(context.Cloud.loggedIn(), false);
    assert.equal(context.Cloud.uid, '');
});

test('a stale profile refresh cannot restore a previous group selection', async () => {
    let resolveRefresh;
    const { context } = cloudContext(() => new Promise(resolve => { resolveRefresh = resolve; }));
    context.Cloud.setSession({ id: 'user-a', groupCode: 'group-a' });
    const refreshing = context.Cloud.refreshSession();

    context.Cloud.setSession({ id: 'user-a', groupCode: 'group-b' });
    resolveRefresh({ record: { id: 'user-a', groupCode: 'group-a' } });

    assert.equal(await refreshing, null);
    assert.equal(context.Cloud.groupCode, 'group-b');
});

test('a stale unauthorized refresh cannot clear a newer session', async () => {
    let rejectRequest;
    const { context } = cloudContext(() => new Promise((_resolve, reject) => {
        rejectRequest = reject;
    }));
    context.Cloud.setSession({ id: 'user-a' });
    const refreshing = context.Cloud.refreshSession();

    context.Cloud.clearSession();
    context.Cloud.setServer('https://other.example');
    context.Cloud.setSession({ id: 'user-b' });
    rejectRequest(Object.assign(new Error('expired session'), { status: 401 }));

    assert.equal(await refreshing, null);
    assert.equal(context.Cloud.loggedIn(), true);
    assert.equal(context.Cloud.uid, 'user-b');
});

test('a late nickname 401 cannot clear a newer session', async () => {
    let rejectUpdate;
    const { context } = cloudContext(() => new Promise((_resolve, reject) => {
        rejectUpdate = reject;
    }));
    context.Cloud.setSession({ id: 'user-a' });
    const fields = new Map([
        ['acc-account-nickname', { value: 'Rider' }],
        ['acc-nickname-save', { disabled: false }]
    ]);
    context.$ = id => fields.get(id);
    context.renderAccount = () => {};
    context.toast = () => {};
    context.console = { warn() {} };
    vm.runInContext(
        sourceBetween('async function saveAccountNickname()', '\nasync function logoutCloudAccount()'),
        context
    );

    const saving = context.saveAccountNickname();
    context.Cloud.clearSession();
    context.Cloud.setServer('https://other.example');
    context.Cloud.setSession({ id: 'user-b' });
    rejectUpdate(Object.assign(new Error('expired session'), { status: 401 }));
    await saving;

    assert.equal(context.Cloud.loggedIn(), true);
    assert.equal(context.Cloud.uid, 'user-b');
});

test('cloud API requests can stay pinned to the server captured by a sync', async () => {
    const requests = [];
    const context = vm.createContext({
        APP_CONFIG: {},
        CLOUD_TIMEOUT_MS: 1000,
        Cloud: { server: 'https://new.example' },
        AbortController,
        FormData,
        URL,
        clearTimeout,
        setTimeout,
        isRetryableCloudStatus: () => false,
        fetch: async url => {
            requests.push(String(url));
            return { ok: true, status: 200, json: async () => ({}) };
        }
    });
    vm.runInContext(
        sourceBetween('async function cloudApi(', '\nfunction normalizeServer('),
        context
    );

    await context.cloudApi('/api/collections/routes/records', 'GET', null, { server: 'https://old.example' });
    assert.deepEqual(requests, ['https://old.example/api/collections/routes/records']);
});

test('remote route pagination stops when the captured sync context changes', async () => {
    const storage = new Map();
    const context = vm.createContext({
        localStorage: {
            getItem(key) { return storage.get(key) || null; },
            setItem(key, value) { storage.set(key, String(value)); }
        }
    });
    vm.runInContext(
        sourceBetween('function cloudSyncStorageKey(', '\nfunction newestRemoteUpdate('),
        context
    );
    let current = true;
    let requestCount = 0;

    const inventory = await context.fetchRemoteRoutes(
        true,
        '',
        async () => {
            requestCount++;
            current = false;
            return { items: [], totalPages: 3 };
        },
        () => current,
        'https://old.example',
        'user-1'
    );

    assert.equal(inventory, null);
    assert.equal(requestCount, 1);
    assert.equal(storage.size, 0);
});

test('completed local route deletion updates memory before stopping a stale sync', async () => {
    const { context, cloud } = routeSyncContext({
        routes: [{ id: 1, remoteId: 'remote-1', kind: 'local', name: 'Local route' }],
        deleteRoute: async () => { cloud.active = false; }
    });

    await context.syncRoutes();

    assert.deepEqual(Array.from(context.getSavedRoutes()), []);
});

test('completed route download updates memory before stopping a stale sync', async () => {
    const { context, cloud } = routeSyncContext({
        remote: [{
            id: 'remote-2',
            clientId: 2,
            track: 'track.json',
            kind: 'recorded',
            name: 'Remote route',
            activityType: 'mtb'
        }],
        putLocal: async () => { cloud.active = false; }
    });

    await context.syncRoutes();

    const routes = Array.from(context.getSavedRoutes());
    assert.equal(routes.length, 1);
    assert.equal(routes[0].id, 2);
    assert.equal(routes[0].remoteId, 'remote-2');
});

test('a queued sync does not run for a different account after its delay', async () => {
    let resolveInventory;
    let signalInventoryStarted;
    let inventoryCalls = 0;
    const inventoryStarted = new Promise(resolve => { signalInventoryStarted = resolve; });
    const { context, cloud } = routeSyncContext({
        fetchRemoteRoutes: () => {
            inventoryCalls++;
            if (inventoryCalls === 1) {
                signalInventoryStarted();
                return new Promise(resolve => { resolveInventory = resolve; });
            }
            return Promise.resolve({ records: [], fullAudit: true });
        }
    });
    let queuedCallback;
    context.setTimeout = callback => { queuedCallback = callback; return 1; };

    const firstSync = context.syncRoutes();
    await inventoryStarted;
    await context.syncRoutes(true);
    cloud.uid = 'user-b';
    cloud.authGeneration++;
    resolveInventory({ records: [], fullAudit: true });
    await firstSync;

    assert.equal(typeof queuedCallback, 'function');
    queuedCallback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(inventoryCalls, 1);
});

test('login does not forward a JWT after the configured server changes', async () => {
    let resolvePassword;
    const calls = [];
    const { context } = cloudContext((requestPath) => {
        calls.push(requestPath);
        if (requestPath.includes('auth-with-password')) {
            return new Promise(resolve => { resolvePassword = resolve; });
        }
        throw new Error('Unexpected request');
    });
    const fields = new Map([
        ['acc-nickname', { value: '' }],
        ['acc-email', { value: 'rider@example.com' }],
        ['acc-pass', { value: 'password' }],
        ['acc-weight', { value: '' }],
        ['acc-height', { value: '' }],
        ['acc-age', { value: '' }]
    ]);
    context.$ = id => fields.get(id);
    context.toast = () => {};
    context.console = { warn() {} };
    vm.runInContext(
        sourceBetween('function ensureAuthServer(server, generation)', '\nasync function saveAccountNickname()'),
        context
    );

    const login = vm.runInContext('accAuth(false)', context);
    context.Cloud.setServer('https://other.example');
    const auth = { token: 'short-lived-jwt' };
    resolvePassword(auth);
    await login;

    assert.equal(auth.token, '');
    assert.deepEqual(calls, ['/api/collections/users/auth-with-password']);
});

test('login discards an exchange response after the configured server changes', async () => {
    let resolveExchange;
    let signalExchangeStarted;
    const exchangeStarted = new Promise(resolve => { signalExchangeStarted = resolve; });
    const { context } = cloudContext(requestPath => {
        if (requestPath.includes('auth-with-password')) return Promise.resolve({ token: 'short-lived-jwt' });
        if (requestPath.includes('/exchange')) {
            signalExchangeStarted();
            return new Promise(resolve => { resolveExchange = resolve; });
        }
        throw new Error('Unexpected request');
    });
    const fields = new Map([
        ['acc-nickname', { value: '' }],
        ['acc-email', { value: 'rider@example.com' }],
        ['acc-pass', { value: 'password' }],
        ['acc-weight', { value: '' }],
        ['acc-height', { value: '' }],
        ['acc-age', { value: '' }]
    ]);
    context.$ = id => fields.get(id);
    context.toast = () => {};
    context.console = { warn() {} };
    vm.runInContext(
        sourceBetween('function ensureAuthServer(server, generation)', '\nasync function saveAccountNickname()'),
        context
    );

    const login = vm.runInContext('accAuth(false)', context);
    await exchangeStarted;
    context.Cloud.setServer('https://other.example');
    resolveExchange({ record: { id: 'user-a' } });
    await login;

    assert.equal(context.Cloud.loggedIn(), false);
    assert.equal(context.Cloud.uid, '');
});

test('restoring a session on reconnect precedes authenticated syncs', async () => {
    const { context } = cloudContext();
    const events = [];
    context.Cloud.sessionActive = false;
    context.Cloud.loggedIn = () => context.Cloud.sessionActive;
    context.Cloud.restoreSession = async () => {
        events.push('restore');
        context.Cloud.sessionActive = true;
        return { id: 'user-1' };
    };
    context.renderAccountProfile = () => events.push('profile');
    context.renderAccount = () => events.push('account');
    context.syncCloudPreferences = () => events.push('preferences');
    context.restoreGroup = () => events.push('group');
    context.syncing = false;
    context.syncRoutes = async () => events.push('routes');
    context.syncSharedPois = () => events.push('pois');
    context.accAuthInFlight = false;
    vm.runInContext(sourceBetween('async function syncWhenOnline()', '\nfunction initAccount()'), context);

    await context.syncWhenOnline();
    assert.deepEqual(events, ['restore', 'profile', 'account', 'group', 'preferences', 'routes', 'pois']);
});

test('reconnect does not restore a session while login is in progress', async () => {
    const { context } = cloudContext();
    let restoreCount = 0;
    context.Cloud.loggedIn = () => false;
    context.Cloud.restoreSession = async () => {
        restoreCount++;
        return null;
    };
    context.accAuthInFlight = true;
    context.syncSharedPois = () => {};
    vm.runInContext(sourceBetween('async function syncWhenOnline()', '\nfunction initAccount()'), context);

    await context.syncWhenOnline();
    assert.equal(restoreCount, 0);
});

test('logout clears local session state when the server already returned 401', async () => {
    const { context } = cloudContext(async () => {
        throw Object.assign(new Error('session expired'), { status: 401 });
    });
    context.Cloud.setSession({ id: 'user-1' });
    context.stopGroup = async () => {};
    context.renderFriends = () => {};
    context.renderAccount = () => {};
    context.toast = () => {};
    vm.runInContext(
        `let logoutInFlight = false;\n${sourceBetween('async function logoutCloudAccount()', '\nasync function putLocal(')}`,
        context
    );

    await context.logoutCloudAccount();
    assert.equal(context.Cloud.loggedIn(), false);
    assert.equal(context.Cloud.uid, '');
});

test('a late logout response does not clear a session created on another server', async () => {
    let resolveLogout;
    let signalLogoutStarted;
    const logoutStarted = new Promise(resolve => { signalLogoutStarted = resolve; });
    const { context } = cloudContext(() => {
        signalLogoutStarted();
        return new Promise(resolve => { resolveLogout = resolve; });
    });
    context.Cloud.setSession({ id: 'user-a' });
    context.stopGroup = async () => {};
    context.renderFriends = () => {};
    context.renderAccount = () => {};
    context.toast = () => {};
    vm.runInContext(
        `let logoutInFlight = false;\n${sourceBetween('async function logoutCloudAccount()', '\nasync function putLocal(')}`,
        context
    );

    const logout = context.logoutCloudAccount();
    await logoutStarted;
    context.Cloud.clearSession();
    context.Cloud.setServer('https://other.example');
    context.Cloud.setSession({ id: 'user-b' });
    resolveLogout({});
    await logout;

    assert.equal(context.Cloud.loggedIn(), true);
    assert.equal(context.Cloud.uid, 'user-b');
});

test('only one remote logout request runs at a time', async () => {
    let resolveLogout;
    let signalLogoutStarted;
    let requestCount = 0;
    const logoutStarted = new Promise(resolve => { signalLogoutStarted = resolve; });
    const { context } = cloudContext(() => {
        requestCount++;
        signalLogoutStarted();
        return new Promise(resolve => { resolveLogout = resolve; });
    });
    context.Cloud.setSession({ id: 'user-a' });
    context.stopGroup = async () => {};
    context.renderFriends = () => {};
    context.renderAccount = () => {};
    context.toast = () => {};
    vm.runInContext(
        `let logoutInFlight = false;\n${sourceBetween('async function logoutCloudAccount()', '\nasync function putLocal(')}`,
        context
    );

    const firstLogout = context.logoutCloudAccount();
    await logoutStarted;
    await context.logoutCloudAccount();
    assert.equal(requestCount, 1);
    resolveLogout({});
    await firstLogout;
});

test('a failed logout restores the active group while the session remains valid', async () => {
    const { context } = cloudContext(async () => {
        throw Object.assign(new Error('server unavailable'), { status: 503 });
    });
    context.Cloud.setSession({ id: 'user-a', groupCode: 'group-a' });
    context.localStorage.setItem('mtb_pro_group_joined', 'group-a');
    context.stopGroup = async () => context.localStorage.removeItem('mtb_pro_group_joined');
    let restoreCount = 0;
    context.restoreGroup = async () => {
        restoreCount++;
        context.localStorage.setItem('mtb_pro_group_joined', 'group-a');
    };
    context.renderFriends = () => {};
    context.renderAccount = () => {};
    context.toast = () => {};
    context.console = { warn() {} };
    vm.runInContext(
        `let logoutInFlight = false;\n${sourceBetween('async function logoutCloudAccount()', '\nasync function putLocal(')}`,
        context
    );

    await context.logoutCloudAccount();

    assert.equal(context.Cloud.loggedIn(), true);
    assert.equal(context.localStorage.getItem('mtb_pro_group_joined'), 'group-a');
    assert.equal(restoreCount, 1);
});
