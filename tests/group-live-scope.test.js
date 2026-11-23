'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'groups.js'), 'utf8');
const renderStart = source.indexOf('function renderFriends(items = []) {');
const refreshStart = source.indexOf('\nasync function refreshFriends(', renderStart);
const publishStart = source.indexOf('\nasync function publishMyLocation(', refreshStart);
const renderAndRefresh = source.slice(renderStart, publishStart);

test('live locations discard old-group responses and render only the active group', async () => {
    let resolveOldGroup;
    let requestCount = 0;
    let visibleOwners = [];
    const cloud = {
        groupCode: 'group-a',
        server: 'https://cloud.example',
        uid: 'user-1',
        authGeneration: 1,
        loggedIn() { return true; }
    };
    const context = vm.createContext({
        Cloud: cloud,
        groupJoined: true,
        groupName: () => cloud.groupCode,
        navigator: { onLine: true },
        document: { visibilityState: 'visible' },
        map: null,
        friendMarkers: new Map(),
        liveLocationIdentityKey: () => `${cloud.server}|${cloud.uid}|${cloud.groupCode}`,
        renderFriendsGroupStatus(items) { visibleOwners = items.map(item => item.owner); },
        publishMyLocation() {},
        removeMyLiveLocation: async () => {},
        loadMyGroup: async () => {},
        isRecording: false,
        isPaused: false,
        console: { warn() {} },
        toast() {},
        cloudApi: async () => {
            requestCount++;
            if (requestCount === 1) {
                return new Promise(resolve => { resolveOldGroup = resolve; });
            }
            return {
                items: [
                    { id: 'old', owner: 'rider-a', groupCode: 'group-a', lat: 41, lon: -8, updated: new Date().toISOString() },
                    { id: 'current', owner: 'rider-b', groupCode: 'group-b', lat: 42, lon: -8, updated: new Date().toISOString() }
                ]
            };
        }
    });
    vm.runInContext(`
        let friendsRefreshPending = false;
        let friendsRefreshQueued = false;
        let friendsRefreshContext = '';
        let friendMarkersContext = '';
        let groupLiveEndpointUnsupportedFor = '';
        let myLiveRecordId = null;
        let groupSyncAvailable = true;
        let lastGroupAuthRefreshAt = Date.now();
        let lastGroupMembershipCheckAt = Date.now();
        let liveLocationRetryBlockedKey = '';
        let liveLocationRetryBlockedStatus = 0;
        const FRIEND_STALE_MS = 120000;
        const GROUP_AUTH_REFRESH_MS = Number.MAX_SAFE_INTEGER;
        const GROUP_MEMBERSHIP_CHECK_MS = Number.MAX_SAFE_INTEGER;
        function liveLocationContextKey() {
            return \`\${Cloud.server}|\${Cloud.uid}|\${Cloud.authGeneration}|\${groupJoined ? groupName() : ''}\`;
        }
        ${renderAndRefresh}
        globalThis.refreshFriends = refreshFriends;
        globalThis.renderFriends = renderFriends;
    `, context);

    const oldRequest = context.refreshFriends();
    await Promise.resolve();
    cloud.groupCode = 'group-b';
    context.refreshFriends();
    resolveOldGroup({
        items: [{ id: 'old', owner: 'rider-a', groupCode: 'group-a', lat: 41, lon: -8, updated: new Date().toISOString() }]
    });
    await oldRequest;
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(requestCount, 2);
    assert.deepEqual(visibleOwners, ['rider-b']);
});
