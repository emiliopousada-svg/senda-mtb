'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function element() {
    const node = {
        children: [],
        listeners: {},
        style: {},
        classList: { toggle() {} },
        addEventListener(name, callback) { this.listeners[name] = callback; },
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); },
        setAttribute() {}
    };
    Object.defineProperty(node, 'textContent', {
        get() { return this._textContent || ''; },
        set(value) {
            this._textContent = String(value);
            this.children = [];
        }
    });
    return node;
}

function groupsContext() {
    const elements = new Map();
    const storage = new Map();
    let context;
    const cloud = {
        uid: 'current-user',
        server: 'https://example.test',
        groupCode: 'group-1',
        nickname: 'Rider',
        authGeneration: 1,
        loggedIn() { return true; },
        invalidateProfileReads() {},
        setSession() {},
        async refreshSession() {
            const result = await context.cloudApi('/api/mtb/auth/session');
            return result ? result.record : null;
        }
    };
    context = vm.createContext({
        Cloud: cloud,
        navigator: { onLine: true },
        document: {
            visibilityState: 'visible',
            createElement: element,
            addEventListener() {}
        },
        window: { addEventListener() {} },
        $: id => {
            if (!elements.has(id)) elements.set(id, element());
            return elements.get(id);
        },
        console: { warn() {} },
        map: null,
        Date,
        setTimeout() { return 1; },
        clearTimeout() {},
        setInterval() { return 1; },
        clearInterval() {},
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'groups.js'), 'utf8'),
        context
    );
    vm.runInContext('groupJoined = true; groupSyncAvailable = true;', context);
    return { context, elements, cloud, storage };
}

test('friends without an uploaded avatar use the app icon', () => {
    const { context } = groupsContext();

    assert.equal(context.friendAvatarUrl({ owner: 'friend-1', avatar: '' }), 'icon-512.png');
    assert.equal(
        context.friendAvatarUrl({ owner: 'friend-1', avatar: 'avatar.jpg' }),
        'https://example.test/api/files/users/friend-1/avatar.jpg?thumb=96x96'
    );
});

test('a failed live-location refresh removes stale friends from the avatar roster', async () => {
    const { context, elements } = groupsContext();
    context.renderFriends([{
        id: 'old-record',
        owner: 'friend',
        groupCode: 'group-1',
        name: 'Friend',
        lat: 11,
        lon: 104,
        updated: new Date().toISOString()
    }]);
    assert.equal(elements.get('friends-group-status').children.length, 1);

    context.cloudApi = async url => {
        if (url.includes('/api/mtb/auth/session')) {
            return { record: { groupCode: 'group-1' } };
        }
        throw Object.assign(new Error('server unavailable'), { status: 500 });
    };
    await context.refreshFriends();

    assert.equal(elements.get('friends-group-status').children.length, 0);
    assert.match(elements.get('friends-group-status').textContent, /No se pudo verificar/);
});

test('a session refresh that clears the group revokes access in the same live refresh', async () => {
    const { context, cloud, storage } = groupsContext();
    let removed = 0;
    let reloaded = 0;
    let rendered = 0;
    let notified = '';
    context.removeMyLiveLocation = async () => { removed++; };
    context.loadMyGroup = async () => { reloaded++; };
    context.renderFriends = () => { rendered++; };
    context.toast = message => { notified = message; };
    cloud.refreshSession = async () => {
        cloud.groupCode = '';
        return { id: cloud.uid, groupCode: '' };
    };
    vm.runInContext('lastGroupAuthRefreshAt = 0;', context);

    await context.refreshFriends();

    assert.equal(vm.runInContext('groupJoined', context), false);
    assert.equal(removed, 1);
    assert.equal(reloaded, 1);
    assert.equal(rendered, 1);
    assert.equal(storage.has('mtb_pro_group_joined'), false);
    assert.match(notified, /revocado tu acceso/);
});

test('a revoked group stays disconnected when reloading the group fails', async () => {
    const { context, elements, cloud } = groupsContext();
    context.removeMyLiveLocation = async () => {};
    context.loadMyGroup = async () => { throw new Error('server unavailable'); };
    context.renderFriends = () => {};
    context.toast = () => {};
    cloud.refreshSession = async () => {
        cloud.groupCode = '';
        return { id: cloud.uid, groupCode: '' };
    };
    vm.runInContext('lastGroupAuthRefreshAt = 0;', context);

    await context.refreshFriends();

    assert.equal(elements.get('group-setup').style.display, 'block');
    assert.equal(elements.get('group-connected').style.display, 'none');
    assert.equal(vm.runInContext('groupJoined', context), false);
});

for (const [changedIdentity, changeIdentity] of [
    ['server', (cloud) => { cloud.server = 'https://other.example'; }],
    ['user', (cloud) => { cloud.uid = 'other-user'; }],
    ['auth generation', (cloud) => { cloud.authGeneration++; }]
]) {
    test(`a session refresh for a different ${changedIdentity} is ignored`, async () => {
        const { context, cloud } = groupsContext();
        let resolveRefresh;
        let removed = 0;
        context.removeMyLiveLocation = async () => { removed++; };
        cloud.refreshSession = () => new Promise(resolve => { resolveRefresh = resolve; });
        vm.runInContext('lastGroupAuthRefreshAt = 0;', context);

        const refreshing = context.refreshFriends();
        await Promise.resolve();
        changeIdentity(cloud);
        resolveRefresh({ id: cloud.uid, groupCode: '' });
        await refreshing;

        assert.equal(removed, 0);
        assert.equal(vm.runInContext('groupJoined', context), true);
    });
}

test('clicking a live friend avatar opens that friend position on the map', () => {
    const { context, elements } = groupsContext();
    let selectedPage = -1;
    let mapPosition = null;
    let openedPopup = false;
    context.goToPage = page => { selectedPage = page; };
    context.markerMock = { openPopup() { openedPopup = true; } };
    vm.runInContext('friendMarkersContext = liveLocationContextKey()', context);
    vm.runInContext("friendMarkers.set('friend-record', markerMock)", context);

    context.renderFriends([{
        id: 'friend-record',
        owner: 'friend',
        groupCode: 'group-1',
        nickname: 'Friend',
        lat: 11,
        lon: 104,
        updated: new Date().toISOString()
    }]);

    context.map = {
        getZoom() { return 14; },
        setView(position, zoom) { mapPosition = { position: JSON.stringify(position), zoom }; }
    };
    const avatar = elements.get('friends-group-status').children[0].children[1];
    avatar.listeners.click();

    assert.equal(selectedPage, 0);
    assert.equal(mapPosition.position, '[11,104]');
    assert.equal(mapPosition.zoom, 16);
    assert.equal(openedPopup, true);
});

test('disabling safety group tracking prevents live-location publishing and retries', async () => {
    const { context } = groupsContext();
    let apiCalls = 0;
    context.safetyGroupTrackingEnabled = () => false;
    context.isRecording = true;
    context.isPaused = false;
    context.lastLat = 40;
    context.lastLon = -3;
    context.lastPositionAt = Date.now();
    context.lastAccuracy = 5;
    context.cloudApi = async () => {
        apiCalls += 1;
        throw new Error('A disabled share should not reach PocketBase.');
    };

    await context.publishMyLocation(true);
    await context.retryPendingLiveLocation();

    assert.equal(apiCalls, 0);
});

test('selecting a group stops before changing pending state when the account changes', async () => {
    const { context, cloud, storage } = groupsContext();
    context.removeMyLiveLocation = async () => {};
    const pendingKey = `mtb_pro_pending_group_leave_${encodeURIComponent(cloud.server)}_user-b`;
    storage.set(pendingKey, JSON.stringify({ groupId: 'group-2' }));
    context.cloudApi = async path => {
        if (path === '/api/mtb/groups/select') {
            cloud.uid = 'user-b';
            cloud.authGeneration++;
            return {};
        }
        throw new Error(`Unexpected request: ${path}`);
    };

    await context.selectGroup('group-2');

    assert.equal(storage.get(pendingKey), JSON.stringify({ groupId: 'group-2' }));
});

test('a session change queues a fresh group restoration after an older one finishes', async () => {
    const { context, cloud } = groupsContext();
    vm.runInContext('groupJoined = false;', context);
    let resolveOldSession;
    let signalOldSessionStarted;
    let refreshCount = 0;
    let groupLoadCount = 0;
    const oldSessionStarted = new Promise(resolve => { signalOldSessionStarted = resolve; });
    context.cloudApi = async path => {
        if (path === '/api/mtb/auth/session') {
            refreshCount++;
            if (refreshCount === 1) {
                signalOldSessionStarted();
                return new Promise(resolve => { resolveOldSession = resolve; });
            }
            return { record: { id: 'user-b', groupCode: '' } };
        }
        throw new Error(`Unexpected request: ${path}`);
    };
    context.syncPendingGroupRankingDeletes = async () => true;
    context.loadMyGroup = async () => { groupLoadCount++; };

    const oldRestore = context.restoreGroup();
    await oldSessionStarted;
    cloud.uid = 'user-b';
    cloud.authGeneration++;
    await context.restoreGroup();
    resolveOldSession({ record: { id: 'user-a', groupCode: '' } });
    await oldRestore;
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(refreshCount, 2);
    assert.equal(groupLoadCount, 1);
});

test('a concurrent profile refresh reconciles a newly selected group', async () => {
    const { context, cloud } = groupsContext();
    let refreshCount = 0;
    let groupLoadCount = 0;
    context.removeMyLiveLocation = async () => {};
    context.cloudApi = async path => {
        if (path === '/api/mtb/groups/select') return {};
        throw new Error(`Unexpected request: ${path}`);
    };
    cloud.refreshSession = async () => {
        refreshCount++;
        return refreshCount === 1 ? null : { id: cloud.uid, groupCode: 'group-2' };
    };
    context.syncPendingGroupRankingDeletes = async () => true;
    context.loadMyGroup = async () => { groupLoadCount++; };
    context.refreshFriends = async () => {};
    context.startFriendsTimer = () => {};

    await context.selectGroup('group-2');

    assert.equal(refreshCount, 2);
    assert.equal(groupLoadCount, 1);
});
