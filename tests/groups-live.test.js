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
    const context = vm.createContext({
        Cloud: {
            uid: 'current-user',
            server: 'https://example.test',
            groupCode: 'group-1',
            nickname: 'Rider',
            loggedIn() { return true; },
            setSession() {}
        },
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
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'groups.js'), 'utf8'),
        context
    );
    vm.runInContext('groupJoined = true; groupSyncAvailable = true;', context);
    return { context, elements };
}

test('a failed live-location refresh removes stale friends from the avatar roster', async () => {
    const { context, elements } = groupsContext();
    context.renderFriends([{
        id: 'old-record',
        owner: 'friend',
        name: 'Friend',
        lat: 11,
        lon: 104,
        updated: new Date().toISOString()
    }]);
    assert.equal(elements.get('friends-group-status').children.length, 1);

    context.cloudApi = async url => {
        if (url.includes('auth-refresh')) {
            return { token: 'token', record: { groupCode: 'group-1' } };
        }
        throw Object.assign(new Error('server unavailable'), { status: 500 });
    };
    await context.refreshFriends();

    assert.equal(elements.get('friends-group-status').children.length, 0);
    assert.match(elements.get('friends-group-status').textContent, /No se pudo verificar/);
});

test('clicking a live friend avatar opens that friend position on the map', () => {
    const { context, elements } = groupsContext();
    let selectedPage = -1;
    let mapPosition = null;
    let openedPopup = false;
    context.goToPage = page => { selectedPage = page; };
    context.markerMock = { openPopup() { openedPopup = true; } };
    vm.runInContext("friendMarkers.set('friend-record', markerMock)", context);

    context.renderFriends([{
        id: 'friend-record',
        owner: 'friend',
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
