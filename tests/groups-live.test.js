'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function element() {
    const node = {
        children: [],
        style: {},
        classList: { toggle() {} },
        addEventListener() {},
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

test('a failed live-location refresh removes stale friend markers from the list', async () => {
    const { context, elements } = groupsContext();
    context.renderFriends([{
        id: 'old-record',
        owner: 'friend',
        name: 'Friend',
        lat: 11,
        lon: 104,
        updated: new Date().toISOString()
    }]);
    assert.equal(elements.get('friends-list').children.length, 1);

    context.cloudApi = async url => {
        if (url.includes('auth-refresh')) {
            return { token: 'token', record: { groupCode: 'group-1' } };
        }
        throw Object.assign(new Error('server unavailable'), { status: 500 });
    };
    await context.refreshFriends();

    assert.equal(elements.get('friends-list').children.length, 0);
    assert.match(elements.get('friends-list').textContent, /No se pudo verificar/);
});
