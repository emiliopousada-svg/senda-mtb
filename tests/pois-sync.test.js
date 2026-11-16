'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function setupPois() {
    const pendingPoi = {
        id: 100,
        clientId: '100-local',
        type: 'bar',
        name: 'Bar local',
        createdBy: 'Rider',
        lat: 11,
        lng: 104,
        pendingShare: true
    };
    const storage = new Map([['mtb_pro_saved_fountains', JSON.stringify([pendingPoi])]]);
    const context = vm.createContext({
        Cloud: {
            server: 'https://mtbpro.ddns.net',
            uid: 'user-1',
            nickname: 'Rider',
            loggedIn() { return true; }
        },
        navigator: { onLine: true },
        document: {
            visibilityState: 'visible',
            addEventListener() {}
        },
        window: { addEventListener() {} },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        $: () => ({ addEventListener() {} }),
        map: null,
        toast() {},
        console: { warn() {} },
        setInterval() { return 1; }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'pois.js'), 'utf8'),
        context
    );
    return context;
}

test('manual POI sync bypasses the automatic retry delay and uploads queued points', async () => {
    const context = setupPois();
    const calls = [];
    context.cloudApi = async (url, method = 'GET', body = null) => {
        calls.push({ url, method, body });
        if (method === 'POST') return { id: 'remote-1', owner: 'user-1' };
        return {
            items: [{
                id: 'remote-1',
                owner: 'user-1',
                clientId: '100-local',
                createdBy: 'Rider',
                type: 'bar',
                name: 'Bar local',
                lat: 11,
                lng: 104,
                created: new Date().toISOString(),
                updated: new Date().toISOString()
            }],
            totalPages: 1
        };
    };
    vm.runInContext('poiSyncRetryAfter = Date.now() + 60000', context);

    assert.equal(await context.syncSharedPois(), false);
    assert.equal(calls.length, 0);
    assert.equal(await context.syncSharedPois(true), true);
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(vm.runInContext('savedFountains[0].remoteId', context), 'remote-1');
});

test('failed POI sync retains points and reports the PocketBase error for retry', async () => {
    const context = setupPois();
    context.cloudApi = async () => {
        throw Object.assign(new Error('Forbidden'), { status: 403 });
    };

    assert.equal(await context.syncSharedPois(true), false);
    assert.equal(vm.runInContext('pendingSharedPoiCount()', context), 1);
    assert.match(context.poiSyncPendingMessage(), /Forbidden/);
});
