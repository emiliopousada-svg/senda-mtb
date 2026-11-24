'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const cloudSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud.js'), 'utf8');
const cloudApiSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud-api.js'), 'utf8');
const routeSyncSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud-routes-sync.js'), 'utf8');

function sourceBetween(startMarker, endMarker, source = cloudSource) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
    assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
    return source.slice(start, end);
}

function sourceFrom(startMarker, source) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
    return source.slice(start);
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

function routeSyncContext({
    routes = [],
    remote = [],
    deleteRoute,
    putLocal,
    fetchRemoteRoutes,
    cloudApi,
    pendingDeleteReadError,
    remoteTrackData = [[0, 0], [1, 1]]
} = {}) {
    let downloadedTrackCount = 0;
    const toasts = [];
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
            async kvGet() {
                if (pendingDeleteReadError) throw pendingDeleteReadError;
                return [];
            },
            async kvSet() {},
            async deleteRoute(...args) {
                if (deleteRoute) return deleteRoute(...args);
            }
        },
        FormData,
        ROUTE_FULL_AUDIT_INTERVAL_MS: 24 * 60 * 60 * 1000,
        ROUTE_NICKNAME_LIMIT: 32,
        clearCloudSyncRetryTimer() {},
        cloudSyncStorageKey() { return 'sync-state'; },
        cloudApi: cloudApi || (async () => ({ token: 'file-token' })),
        fetch: async () => {
            downloadedTrackCount++;
            return {
                ok: true,
                async text() { return JSON.stringify(remoteTrackData); }
            };
        },
        fetchRemoteRoutes: fetchRemoteRoutes || (async () => ({ records: remote, fullAudit: true })),
        garageRoutesChanged() { return true; },
        isRetryableCloudStatus: () => false,
        localStorage: { getItem() { return null; }, setItem() {} },
        navigator: { onLine: true },
        normalizeRemoteTrack: () => [[0, 0], [1, 1]],
        routeDataFromSync(trackData) {
            const points = Array.isArray(trackData) ? trackData : trackData && trackData.points;
            if (!Array.isArray(points)) return null;
            const hasPrivateMetadata = Boolean(trackData && !Array.isArray(trackData) && trackData.format === 2);
            return {
                points,
                hasPrivateMetadata,
                description: hasPrivateMetadata ? trackData.description : null,
                pois: hasPrivateMetadata ? trackData.pois : null
            };
        },
        routeForm: route => route,
        renderAccount() {},
        renderAccountProfile() {},
        renderSavedRoutes() {},
        refreshStats() {},
        setTimeout,
        clearTimeout,
        syncPendingGroupRankingDeletes: async () => true,
        toast(message) { toasts.push(message); },
        activityTypeFromName: () => null,
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
        ${sourceBetween('async function flushPendingDeletes(', '\nlet syncing =', routeSyncSource)}
        ${sourceFrom('async function syncRoutes(', routeSyncSource)}
        globalThis.syncRoutes = syncRoutes;`,
        context
    );
    context.setSavedRoutes(routes);
    return { context, cloud, getDownloadedTrackCount: () => downloadedTrackCount, toasts };
}

function pendingDeleteContext(initialPendingDeletes) {
    let pendingDeletes = initialPendingDeletes.slice();
    const writes = [];
    const context = vm.createContext({
        DB: {
            async kvGet(key) {
                assert.equal(key, 'pendingDeletes');
                return pendingDeletes.slice();
            },
            async kvSet(key, value) {
                writes.push({ key, value: Array.from(value) });
                pendingDeletes = Array.from(value);
            }
        },
        console: { warn() {} }
    });
    vm.runInContext(
        `${sourceBetween('async function flushPendingDeletes(', '\nlet syncing =', routeSyncSource)}\nglobalThis.flushPendingDeletes = flushPendingDeletes;`,
        context
    );
    return { context, writes, getPendingDeletes: () => pendingDeletes.slice() };
}

test('stale session restoration cannot replace a newer login', async () => {
    let rejectRequest;
    const { context } = cloudContext(() => new Promise((_resolve, reject) => {
        rejectRequest = reject;
    }));
    context.localStorage.setItem('mtb_pro_token', 'old-token');
    const restoring = context.Cloud.restoreSession();

    context.Cloud.setSession({ id: 'new-user' });
    rejectRequest(Object.assign(new Error('expired session'), { status: 401 }));

    assert.equal(await restoring, null);
    assert.equal(context.Cloud.loggedIn(), true);
    assert.equal(context.Cloud.uid, 'new-user');
});

test('native legacy session tokens are copied to secure storage before local removal', async () => {
    const secureValues = new Map();
    const { context, values } = cloudContext();
    context.MTBNativeApp = {
        isNativePlatform: () => true,
        async getSecureItem(key) { return secureValues.get(key) || null; },
        async setSecureItem(key, value) { secureValues.set(key, value); },
        async removeSecureItem(key) { secureValues.delete(key); }
    };
    values.set('mtb_pro_token', 'legacy-token');

    assert.equal(await context.Cloud.getSessionToken(), 'legacy-token');
    assert.equal(secureValues.get(context.Cloud.secureTokenKey), 'legacy-token');
    assert.equal(values.has('mtb_pro_token'), false);
});

test('native legacy token remains available when secure migration fails', async () => {
    const { context, values } = cloudContext();
    context.MTBNativeApp = {
        isNativePlatform: () => true,
        async getSecureItem() { return null; },
        async setSecureItem() { throw new Error('secure storage unavailable'); },
        async removeSecureItem() {}
    };
    values.set('mtb_pro_token', 'legacy-token');

    await assert.rejects(context.Cloud.getSessionToken(), /secure storage unavailable/);
    assert.equal(values.get('mtb_pro_token'), 'legacy-token');
});

test('native session tokens are written and removed through secure storage', async () => {
    const secureValues = new Map();
    const { context, values } = cloudContext();
    context.MTBNativeApp = {
        isNativePlatform: () => true,
        async getSecureItem(key) { return secureValues.get(key) || null; },
        async setSecureItem(key, value) { secureValues.set(key, value); },
        async removeSecureItem(key) { secureValues.delete(key); }
    };

    await context.Cloud.setSession({ id: 'user-1' }, 'native-token', context.Cloud.authGeneration);
    assert.equal(secureValues.get(context.Cloud.secureTokenKey), 'native-token');
    assert.equal(values.has('mtb_pro_token'), false);
    assert.equal(context.Cloud.loggedIn(), true);

    await context.Cloud.clearSession();
    assert.equal(secureValues.has(context.Cloud.secureTokenKey), false);
    assert.equal(context.Cloud.loggedIn(), false);
});

test('changing servers invalidates an in-flight session restoration', async () => {
    let resolveRequest;
    const { context } = cloudContext(() => new Promise(resolve => {
        resolveRequest = resolve;
    }));
    context.localStorage.setItem('mtb_pro_token', 'old-token');
    const restoring = context.Cloud.restoreSession();

    context.Cloud.setServer('https://other.example');
    resolveRequest({ record: { id: 'old-server-user' } });

    assert.equal(await restoring, null);
    assert.equal(context.Cloud.loggedIn(), false);
    assert.equal(context.Cloud.uid, '');
});

test('switching servers stops the active group before clearing local credentials', async () => {
    const calls = [];
    const { context } = cloudContext(async (requestPath, method, body, options) => {
        calls.push({ requestPath, method, server: options.server });
        return {};
    });
    context.Cloud.setServer('https://same.example:9443');
    context.Cloud.setSession({ id: 'user-a' });
    context.stopGroup = async () => { calls.push({ requestPath: 'stopGroup' }); };

    const nextServer = await context.Cloud.switchServer('https://same.example:9444');

    assert.equal(nextServer, 'https://same.example:9444');
    assert.deepEqual(calls, [{ requestPath: 'stopGroup' }]);
    assert.equal(context.Cloud.server, 'https://same.example:9444');
    assert.equal(context.Cloud.loggedIn(), false);
});

test('switching servers does not depend on the old server being reachable', async () => {
    const { context } = cloudContext(async () => {
        throw Object.assign(new Error('old server unavailable'), { status: 503 });
    });
    context.Cloud.setServer('https://same.example:9443');
    context.Cloud.setSession({ id: 'user-a' });

    const server = await context.Cloud.switchServer('https://same.example:9444');

    assert.equal(server, 'https://same.example:9444');
    assert.equal(context.Cloud.server, 'https://same.example:9444');
    assert.equal(context.Cloud.loggedIn(), false);
});

test('switching servers does not contact an unavailable server after session absence is confirmed', async () => {
    let requestCount = 0;
    const { context } = cloudContext(async () => {
        requestCount++;
        throw new Error('The previous server is unavailable.');
    });
    context.Cloud.clearSession();

    const server = await context.Cloud.switchServer('https://new.example');

    assert.equal(server, 'https://new.example');
    assert.equal(context.Cloud.server, 'https://new.example');
    assert.equal(requestCount, 0);
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

test('a stale profile refresh cannot overwrite a saved nickname', async () => {
    let resolveSession;
    const { context } = cloudContext(requestPath => {
        if (requestPath === '/api/collections/users/auth-refresh') {
            return new Promise(resolve => { resolveSession = resolve; });
        }
        return Promise.resolve({ id: 'user-a', nickname: 'New name' });
    });
    context.Cloud.setSession({ id: 'user-a', nickname: 'Old name' });
    context.$ = id => new Map([
        ['acc-account-nickname', { value: 'New name' }],
        ['acc-nickname-save', { disabled: false }]
    ]).get(id);
    context.renderAccount = () => {};
    context.toast = () => {};
    context.syncRoutes = () => {};
    context.syncSharedPois = () => {};
    context.console = { warn() {} };
    vm.runInContext(
        sourceBetween('async function saveAccountNickname()', '\nasync function logoutCloudAccount()'),
        context
    );

    const refreshing = context.Cloud.refreshSession();
    const saving = context.saveAccountNickname();
    await saving;
    resolveSession({ record: { id: 'user-a', nickname: 'Old name' } });

    assert.equal(await refreshing, null);
    assert.equal(context.Cloud.nickname, 'New name');
});

test('cloud API requests can stay pinned to the server captured by a sync', async () => {
    const requests = [];
    let requestOptions;
    const context = vm.createContext({
        APP_CONFIG: {},
        CLOUD_TIMEOUT_MS: 1000,
        Cloud: { server: 'https://new.example', async getSessionToken() { return null; } },
        AbortController,
        FormData,
        URL,
        clearTimeout,
        localStorage: { getItem() { return null; } },
        setTimeout,
        isRetryableCloudStatus: () => false,
        fetch: async (url, options) => {
            requests.push(String(url));
            requestOptions = options;
            return { ok: true, status: 200, json: async () => ({}) };
        }
    });
    vm.runInContext(
        sourceBetween('async function cloudApi(', '\nfunction normalizeServer(', cloudApiSource),
        context
    );

    await context.cloudApi('/api/collections/routes/records', 'GET', null, { server: 'https://old.example' });
    assert.deepEqual(requests, ['https://old.example/api/collections/routes/records']);
    assert.equal(requestOptions.credentials, 'omit');
});

test('cloud API authorization reads the token from the session storage abstraction', async () => {
    let requestOptions;
    const context = vm.createContext({
        APP_CONFIG: {},
        CLOUD_TIMEOUT_MS: 1000,
        Cloud: {
            server: 'https://server.example',
            async getSessionToken() { return 'secure-token'; }
        },
        AbortController,
        FormData,
        URL,
        clearTimeout,
        localStorage: { getItem() { return null; } },
        setTimeout,
        isRetryableCloudStatus: () => false,
        fetch: async (_url, options) => {
            requestOptions = options;
            return { ok: true, status: 200, json: async () => ({}) };
        }
    });
    vm.runInContext(
        sourceBetween('async function cloudApi(', '\nfunction normalizeServer(', cloudApiSource),
        context
    );

    await context.cloudApi('/api/collections/routes/records');
    assert.equal(requestOptions.headers.Authorization, 'secure-token');
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
        sourceBetween('function cloudSyncStorageKey(', '\nfunction newestRemoteUpdate(', routeSyncSource),
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
        routes: [{
            id: 1,
            remoteId: 'remote-1',
            remoteServer: 'https://server.example',
            kind: 'local',
            name: 'Local route'
        }],
        deleteRoute: async () => { cloud.active = false; }
    });

    await context.syncRoutes();

    assert.deepEqual(Array.from(context.getSavedRoutes()), []);
});

test('route sync does not contact the server without an active session', async () => {
    const requests = [];
    const { context, cloud } = routeSyncContext({
        routes: [{ id: 1, kind: 'imported', communityRouteId: 'community-1', dirty: true }],
        fetchRemoteRoutes: async () => {
            requests.push('fetch');
            return { records: [], fullAudit: true };
        },
        cloudApi: async () => {
            requests.push('api');
            return { items: [] };
        }
    });
    cloud.active = false;

    await context.syncRoutes();

    assert.deepEqual(requests, []);
});

test('pending route deletes clear successful and not-found entries', async () => {
    const { context, writes, getPendingDeletes } = pendingDeleteContext(['deleted-route', 'already-gone']);
    const requests = [];
    const failures = [];

    const skipped = await context.flushPendingDeletes({
        isCurrentSync: () => true,
        async syncCloudApi(path, method) {
            requests.push({ path, method });
            if (path.endsWith('/already-gone')) {
                throw Object.assign(new Error('not found'), { status: 404 });
            }
        },
        noteSyncFailure(...failure) { failures.push(failure); }
    });

    assert.deepEqual(requests.map(request => request.method), ['DELETE', 'DELETE']);
    assert.deepEqual(getPendingDeletes(), []);
    assert.deepEqual(writes, [{ key: 'pendingDeletes', value: [] }]);
    assert.deepEqual(Array.from(skipped), ['deleted-route', 'already-gone']);
    assert.deepEqual(failures, []);
});

test('pending route delete errors remain queued and are reported for retry', async () => {
    const { context, writes, getPendingDeletes } = pendingDeleteContext(['retry-route']);
    const failures = [];
    const retryableError = Object.assign(new Error('server unavailable'), {
        status: 503,
        retryable: true
    });

    await context.flushPendingDeletes({
        isCurrentSync: () => true,
        async syncCloudApi() { throw retryableError; },
        noteSyncFailure(...failure) { failures.push(failure); }
    });

    assert.deepEqual(getPendingDeletes(), ['retry-route']);
    assert.deepEqual(writes, [{ key: 'pendingDeletes', value: ['retry-route'] }]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0][1], retryableError);
});

test('route sync does not redownload routes when the pending-delete queue cannot be read', async () => {
    const { context, getDownloadedTrackCount, toasts } = routeSyncContext({
        remote: [{
            id: 'deleted-remotely',
            clientId: 42,
            name: 'Deleted route',
            track: 'track.json'
        }],
        pendingDeleteReadError: new Error('storage unavailable')
    });

    await context.syncRoutes(true);

    assert.deepEqual(Array.from(context.getSavedRoutes()), []);
    assert.equal(getDownloadedTrackCount(), 0);
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /No se pudo leer la cola de borrados: storage unavailable/);
});

test('pending route deletes stop without persisting when the session changes', async () => {
    const pending = ['route-one', 'route-two'];
    const { context, writes, getPendingDeletes } = pendingDeleteContext(pending);
    let current = true;
    let requestCount = 0;

    const result = await context.flushPendingDeletes({
        isCurrentSync: () => current,
        async syncCloudApi() {
            requestCount++;
            current = false;
        },
        noteSyncFailure() {}
    });

    assert.equal(result, null);
    assert.equal(requestCount, 1);
    assert.deepEqual(getPendingDeletes(), pending);
    assert.deepEqual(writes, []);
});

test('a full audit on another server does not delete a locally saved remote route', async () => {
    let deleteCount = 0;
    const { context } = routeSyncContext({
        routes: [{
            id: 4,
            remoteId: 'old-remote',
            remoteServer: 'https://old.example',
            kind: 'local',
            name: 'Local route',
            dirty: true
        }],
        deleteRoute: async () => { deleteCount++; }
    });

    await context.syncRoutes();

    const [route] = context.getSavedRoutes();
    assert.equal(deleteCount, 0);
    assert.ok(route);
});

test('switching back to a server searches for its existing route before creating one', async () => {
    let createCount = 0;
    const { context } = routeSyncContext({
        routes: [{
            id: 5,
            remoteId: 'remote-b',
            remoteServer: 'https://other.example',
            kind: 'local',
            name: 'Existing route',
            activityType: 'mtb',
            createdBy: 'Rider',
            dirty: false
        }],
        fetchRemoteRoutes: async () => ({ records: [], fullAudit: false }),
        cloudApi: async path => {
            if (path.includes('filter=')) {
                return { items: [{ id: 'remote-a', clientId: 5, name: 'Existing route', createdBy: 'Rider' }] };
            }
            if (path === '/api/collections/routes/records') createCount++;
            return { token: 'file-token', id: 'remote-new' };
        }
    });

    await context.syncRoutes();

    const [route] = context.getSavedRoutes();
    assert.equal(createCount, 0);
    assert.equal(route.remoteId, 'remote-a');
    assert.equal(route.remoteServer, 'https://server.example');
});

test('legacy routes with unknown remote server are not re-created without a match', async () => {
    let createCount = 0;
    const { context } = routeSyncContext({
        routes: [{
            id: 6,
            remoteId: 'unknown-remote',
            kind: 'local',
            name: 'Legacy route',
            dirty: true
        }],
        cloudApi: async path => {
            if (path === '/api/collections/routes/records') createCount++;
            return { token: 'file-token', id: 'remote-new' };
        }
    });

    await context.syncRoutes();

    assert.equal(createCount, 0);
    assert.equal(context.getSavedRoutes().length, 1);
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

test('updated remote routes refresh private descriptions and photo POIs', async () => {
    const remoteUpdated = '2026-11-24 15:00:00.000Z';
    const { context, getDownloadedTrackCount } = routeSyncContext({
        routes: [{
            id: 9,
            remoteId: 'remote-9',
            remoteServer: 'https://server.example',
            remoteUpdated: '2026-11-23 15:00:00.000Z',
            kind: 'recorded',
            name: 'Old name',
            description: 'Old description',
            pois: [],
            points: [[0, 0]],
            dirty: false
        }],
        remote: [{
            id: 'remote-9',
            clientId: 9,
            track: 'track.json',
            updated: remoteUpdated,
            createdBy: 'Rider',
            kind: 'recorded',
            name: 'Old name',
            activityType: 'mtb'
        }],
        remoteTrackData: {
            format: 2,
            points: [[1, 2]],
            description: 'Updated description',
            pois: [{ lat: 1, lng: 2, caption: 'Foto', photoData: 'encoded' }]
        }
    });

    await context.syncRoutes();

    const [route] = context.getSavedRoutes();
    assert.equal(getDownloadedTrackCount(), 1);
    assert.equal(route.remoteUpdated, remoteUpdated);
    assert.equal(route.description, 'Updated description');
    assert.deepEqual(Array.from(route.points[0]), [1, 2]);
    assert.equal(route.pois[0].caption, 'Foto');
});

test('legacy remote track updates preserve local private metadata', async () => {
    const remoteUpdated = '2026-11-24 15:00:00.000Z';
    let patchedRoute;
    const { context, getDownloadedTrackCount } = routeSyncContext({
        routes: [{
            id: 10,
            remoteId: 'remote-10',
            remoteServer: 'https://server.example',
            remoteUpdated: '2026-11-23 15:00:00.000Z',
            kind: 'recorded',
            name: 'Legacy route',
            description: 'Keep this description',
            pois: [{ lat: 1, lng: 2, caption: 'Local photo' }],
            points: [[0, 0]],
            dirty: false
        }],
        remote: [{
            id: 'remote-10',
            clientId: 10,
            track: 'legacy.json',
            updated: remoteUpdated,
            createdBy: 'Rider',
            kind: 'recorded',
            name: 'Legacy route'
        }],
        remoteTrackData: [[3, 4], [5, 6]],
        cloudApi: async (path, method, body) => {
            if (path.endsWith('/remote-10')) {
                patchedRoute = body;
                return { id: 'remote-10', updated: remoteUpdated };
            }
            return { token: 'file-token' };
        }
    });

    await context.syncRoutes();

    const [route] = context.getSavedRoutes();
    assert.equal(getDownloadedTrackCount(), 1);
    assert.equal(route.remoteUpdated, remoteUpdated);
    assert.equal(route.description, 'Keep this description');
    assert.equal(route.pois[0].caption, 'Local photo');
    assert.deepEqual(Array.from(route.points[0]), [3, 4]);
    assert.equal(patchedRoute.description, 'Keep this description');
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

test('a queued sync for the same account runs once after the current sync', async () => {
    let resolveFirstInventory;
    let signalFirstInventoryStarted;
    let signalSecondRender;
    let inventoryCalls = 0;
    let renderCalls = 0;
    const firstInventoryStarted = new Promise(resolve => { signalFirstInventoryStarted = resolve; });
    const secondRender = new Promise(resolve => { signalSecondRender = resolve; });
    const { context } = routeSyncContext({
        fetchRemoteRoutes: () => {
            inventoryCalls++;
            if (inventoryCalls === 1) {
                signalFirstInventoryStarted();
                return new Promise(resolve => { resolveFirstInventory = resolve; });
            }
            return Promise.resolve({ records: [], fullAudit: true });
        }
    });
    context.renderSavedRoutes = () => {
        renderCalls++;
        if (renderCalls === 2) signalSecondRender();
    };
    let queuedCallback;
    context.setTimeout = callback => { queuedCallback = callback; return 1; };

    const firstSync = context.syncRoutes();
    await firstInventoryStarted;
    await context.syncRoutes();
    resolveFirstInventory({ records: [], fullAudit: true });
    await firstSync;

    assert.equal(typeof queuedCallback, 'function');
    queuedCallback();
    await secondRender;
    assert.equal(inventoryCalls, 2);
});

test('registration uploads an optional compressed avatar with the account record', async () => {
    const calls = [];
    const sourceFile = { type: 'image/png', size: 1024 };
    const jpeg = new Blob(['compressed avatar'], { type: 'image/jpeg' });
    const { context } = cloudContext(async (requestPath, method, body) => {
        calls.push({ requestPath, method, body });
        if (requestPath === '/api/collections/users/records') return { id: 'user-1' };
        if (requestPath === '/api/collections/users/auth-with-password') {
            return { token: 'bearer-token', record: { id: 'user-1', email: 'rider@example.com', nickname: 'Rider' } };
        }
        throw new Error(`Unexpected request: ${requestPath}`);
    });
    const avatarInput = { files: [sourceFile], value: 'avatar.png' };
    const fields = new Map([
        ['acc-nickname', { value: 'Rider' }],
        ['acc-email', { value: 'rider@example.com' }],
        ['acc-pass', { value: 'secure-password' }],
        ['acc-weight', { value: '' }],
        ['acc-height', { value: '' }],
        ['acc-age', { value: '' }],
        ['acc-home-location', { value: 'Ribeira' }],
        ['acc-register-avatar-file', avatarInput],
        ['acc-account-nickname', { value: '' }]
    ]);
    context.$ = id => fields.get(id) || null;
    context.FormData = FormData;
    context.accountAvatarToJpeg = async file => {
        assert.equal(file, sourceFile);
        return jpeg;
    };
    context.Cloud.clearSession = function () {
        this.sessionActive = false;
        this.authGeneration++;
    };
    context.renderAccountProfile = () => {};
    context.syncPendingAccountAvatar = async () => {};
    context.syncCloudPreferences = async () => {};
    context.renderAccount = () => {};
    context.restoreGroup = async () => {};
    context.syncRoutes = () => {};
    context.syncSharedPois = async () => true;
    context.pendingSharedPoiCount = () => 0;
    context.poiSyncPendingMessage = () => '';
    context.toast = () => {};
    context.console = { warn() {} };
    vm.runInContext(
        sourceBetween('function ensureAuthServer(server, generation)', '\nasync function saveAccountNickname()'),
        context
    );

    await context.accAuth(true);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'POST');
    assert.ok(calls[0].body instanceof FormData);
    assert.equal(calls[0].body.get('nickname'), 'Rider');
    assert.equal(calls[0].body.get('homeLocation'), 'Ribeira');
    assert.equal(calls[0].body.get('avatar').name, 'avatar.jpg');
    assert.equal(await calls[0].body.get('avatar').text(), 'compressed avatar');
    assert.equal(avatarInput.value, '');
});

test('manual account sync shows progress and returns to the ready state when complete', async () => {
    const { context } = cloudContext();
    const classes = new Set();
    const label = { textContent: 'Sincronizar' };
    const attributes = {};
    const accountSyncButton = { disabled: false };
    const button = {
        disabled: true,
        title: '',
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            },
            contains(name) { return classes.has(name); }
        },
        querySelector(selector) {
            return selector === '.profile-manual-sync-label' ? label : null;
        },
        setAttribute(name, value) { attributes[name] = value; }
    };
    context.$ = id => id === 'profile-manual-sync' ? button
        : id === 'acc-sync' ? accountSyncButton
            : null;
    context.navigator = { onLine: true };
    context.toast = () => {};
    context.pendingSharedPoiCount = () => 0;
    context.poiSyncPendingMessage = () => '';
    vm.runInContext(
        sourceBetween('let manualAccountSyncInFlight = false;', '\nfunction renderAccount()'),
        context
    );

    context.renderProfileManualSyncButton();
    assert.equal(button.disabled, true);
    assert.equal(accountSyncButton.disabled, true);
    assert.equal(button.title, 'Inicia sesión para sincronizar');
    context.Cloud.setSession({ id: 'user-1', nickname: 'Rider' }, 'token');
    context.renderProfileManualSyncButton();
    assert.equal(button.disabled, false);
    assert.equal(accountSyncButton.disabled, false);

    let finishPreferences;
    let signalStarted;
    const started = new Promise(resolve => { signalStarted = resolve; });
    const calls = [];
    context.syncCloudPreferences = () => {
        calls.push('preferences');
        signalStarted();
        return new Promise(resolve => { finishPreferences = resolve; });
    };
    context.syncRoutes = async manual => { calls.push(manual ? 'routes-manual' : 'routes'); };
    context.restoreGroup = async () => { calls.push('group'); };
    context.syncSharedPois = async () => { calls.push('pois'); return true; };

    const sync = context.syncAccountManually();
    await started;
    assert.equal(button.disabled, true);
    assert.equal(accountSyncButton.disabled, true);
    assert.equal(button.title, 'Sincronizando…');
    assert.equal(label.textContent, 'Sincronizando…');
    assert.equal(attributes['aria-busy'], 'true');
    assert.equal(classes.has('is-syncing'), true);

    finishPreferences(true);
    await sync;

    assert.deepEqual(calls, ['preferences', 'routes-manual', 'group', 'pois']);
    assert.equal(button.disabled, false);
    assert.equal(accountSyncButton.disabled, false);
    assert.equal(button.title, 'Sincronizar ahora');
    assert.equal(label.textContent, 'Sincronizar');
    assert.equal(attributes['aria-busy'], 'false');
    assert.equal(classes.has('is-syncing'), false);
});

test('login discards a bearer token after the configured server changes', async () => {
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
        ['acc-age', { value: '' }],
        ['acc-register-avatar-file', { files: [{ type: 'image/png', size: 10 }], value: 'avatar.png' }]
    ]);
    context.$ = id => fields.get(id);
    context.accountAvatarToJpeg = () => { throw new Error('Login must not process the registration avatar'); };
    context.toast = () => {};
    context.console = { warn() {} };
    vm.runInContext(
        sourceBetween('function ensureAuthServer(server, generation)', '\nasync function saveAccountNickname()'),
        context
    );

    const login = vm.runInContext('accAuth(false)', context);
    context.Cloud.setServer('https://other.example');
    const auth = { token: 'bearer-token', record: { id: 'user-a' } };
    resolvePassword(auth);
    await login;

    assert.equal(context.localStorage.getItem('mtb_pro_token'), null);
    assert.deepEqual(calls, ['/api/collections/users/auth-with-password']);
});

test('login discards an authentication response after the configured server changes', async () => {
    let resolvePassword;
    const { context } = cloudContext(requestPath => {
        if (requestPath.includes('auth-with-password')) return new Promise(resolve => { resolvePassword = resolve; });
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
    resolvePassword({ token: 'bearer-token', record: { id: 'user-a' } });
    await login;

    assert.equal(context.Cloud.loggedIn(), false);
    assert.equal(context.Cloud.uid, '');
    assert.equal(context.localStorage.getItem('mtb_pro_token'), null);
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
        `let logoutInFlight = false;\n${sourceBetween('async function logoutCloudAccount()', '\nfunction initSettings(')}`,
        context
    );

    await context.logoutCloudAccount();
    assert.equal(context.Cloud.loggedIn(), false);
    assert.equal(context.Cloud.uid, '');
});

test('a late group stop does not clear a session created on another server', async () => {
    let resolveStop;
    const groupStopStarted = new Promise(resolve => { resolveStop = resolve; });
    const { context } = cloudContext();
    context.Cloud.setSession({ id: 'user-a' });
    context.stopGroup = () => groupStopStarted;
    context.renderFriends = () => {};
    context.renderAccount = () => {};
    context.toast = () => {};
    vm.runInContext(
        `let logoutInFlight = false;\n${sourceBetween('async function logoutCloudAccount()', '\nfunction initSettings(')}`,
        context
    );

    const logout = context.logoutCloudAccount();
    await new Promise(resolve => setImmediate(resolve));
    context.Cloud.clearSession();
    context.Cloud.setServer('https://other.example');
    context.Cloud.setSession({ id: 'user-b' });
    resolveStop();
    await logout;

    assert.equal(context.Cloud.loggedIn(), true);
    assert.equal(context.Cloud.uid, 'user-b');
});

test('only one logout can wait for group shutdown at a time', async () => {
    let resolveStop;
    let stopCount = 0;
    const groupStopStarted = new Promise(resolve => { resolveStop = resolve; });
    const { context } = cloudContext();
    context.Cloud.setSession({ id: 'user-a' });
    context.stopGroup = () => {
        stopCount++;
        return groupStopStarted;
    };
    context.renderFriends = () => {};
    context.renderAccount = () => {};
    context.toast = () => {};
    vm.runInContext(
        `let logoutInFlight = false;\n${sourceBetween('async function logoutCloudAccount()', '\nfunction initSettings(')}`,
        context
    );

    const firstLogout = context.logoutCloudAccount();
    await new Promise(resolve => setImmediate(resolve));
    await context.logoutCloudAccount();
    assert.equal(stopCount, 1);
    resolveStop();
    await firstLogout;
});

test('a failed group shutdown leaves the local session intact', async () => {
    const { context } = cloudContext();
    context.Cloud.setSession({ id: 'user-a', groupCode: 'group-a' });
    context.localStorage.setItem('mtb_pro_group_joined', 'group-a');
    context.stopGroup = async () => { throw new Error('group unavailable'); };
    context.renderFriends = () => {};
    context.renderAccount = () => {};
    context.toast = () => {};
    context.console = { warn() {} };
    vm.runInContext(
        `let logoutInFlight = false;\n${sourceBetween('async function logoutCloudAccount()', '\nfunction initSettings(')}`,
        context
    );

    await assert.rejects(context.logoutCloudAccount(), /group unavailable/);

    assert.equal(context.Cloud.loggedIn(), true);
    assert.equal(context.localStorage.getItem('mtb_pro_group_joined'), 'group-a');
});
