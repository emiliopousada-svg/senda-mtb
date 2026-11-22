'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'group-rankings.js'), 'utf8');

test('pending ranking deletes stop and stay queued when the signed-in account changes', async () => {
    let resolvePending;
    let requestCount = 0;
    let writeCount = 0;
    const cloud = {
        uid: 'user-a',
        server: 'https://old.example',
        loggedIn() { return true; }
    };
    const context = vm.createContext({
        Cloud: cloud,
        navigator: { onLine: true },
        DB: {
            kvGet() {
                return new Promise(resolve => { resolvePending = resolve; });
            },
            async kvSet() { writeCount++; }
        },
        cloudApi: async () => { requestCount++; },
        console: { warn() {} },
        toast() {}
    });
    const start = source.indexOf('async function syncPendingGroupRankingDeletes(');
    assert.notEqual(start, -1);
    vm.runInContext(
        `${source.slice(start)}\nlet groupRankingDeletesSyncing = false;\nglobalThis.syncPendingGroupRankingDeletes = syncPendingGroupRankingDeletes;`,
        context
    );

    const syncing = context.syncPendingGroupRankingDeletes();
    cloud.uid = 'user-b';
    cloud.server = 'https://new.example';
    resolvePending([{ ownerId: 'user-a', server: 'https://old.example', clientId: 7 }]);
    await syncing;

    assert.equal(requestCount, 0);
    assert.equal(writeCount, 0);
});

test('pending ranking deletes stop when the same account signs in with a new session', async () => {
    let resolvePending;
    let requestCount = 0;
    const cloud = {
        uid: 'user-a',
        server: 'https://old.example',
        authGeneration: 1,
        loggedIn() { return true; }
    };
    const context = vm.createContext({
        Cloud: cloud,
        navigator: { onLine: true },
        DB: { kvGet() { return new Promise(resolve => { resolvePending = resolve; }); } },
        cloudApi: async () => { requestCount++; },
        console: { warn() {} },
        toast() {}
    });
    const start = source.indexOf('async function syncPendingGroupRankingDeletes(');
    vm.runInContext(
        `${source.slice(start)}\nlet groupRankingDeletesSyncing = false;\nglobalThis.syncPendingGroupRankingDeletes = syncPendingGroupRankingDeletes;`,
        context
    );

    const syncing = context.syncPendingGroupRankingDeletes();
    cloud.authGeneration++;
    resolvePending([{ ownerId: 'user-a', server: 'https://old.example', clientId: 7 }]);
    await syncing;

    assert.equal(requestCount, 0);
});

test('manual ranking share stops if the account changes while confirmation is open', async () => {
    let resolveConfirmation;
    let writeCount = 0;
    let apiCalls = 0;
    const cloud = {
        uid: 'user-a',
        server: 'https://old.example',
        groupCode: 'group-a',
        authGeneration: 1,
        loggedIn() { return true; }
    };
    const context = vm.createContext({
        Cloud: cloud,
        navigator: { onLine: true },
        DB: { async put() { writeCount++; } },
        cloudApi: async () => { apiCalls++; },
        statsAnalyzeRoute() {
            return { distanceKm: 10, movingTimeSec: 1800, maxSpeed: 30, elevationGain: 500 };
        },
        groupJoined: true,
        groupInfo: { name: 'Group A' },
        fmtDur() { return '30 min'; },
        modal() { return new Promise(resolve => { resolveConfirmation = resolve; }); },
        toast() {},
        console: { warn() {} }
    });
    const start = source.indexOf('async function shareRouteToGroupRanking(');
    const end = source.indexOf('\nasync function syncPendingGroupRankingDeletes(', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(
        `${source.slice(start, end)}\nglobalThis.shareRouteToGroupRanking = shareRouteToGroupRanking;`,
        context
    );

    const route = { id: 7, kind: 'recorded' };
    const sharing = context.shareRouteToGroupRanking(route, null);
    cloud.uid = 'user-b';
    cloud.server = 'https://new.example';
    cloud.authGeneration++;
    resolveConfirmation(true);

    assert.equal(await sharing, false);
    assert.equal(writeCount, 0);
    assert.equal(apiCalls, 0);
    assert.equal(route.groupRankingOwnerId, undefined);
});

test('a rejected ranking share retains its confirmed group as the pending target', async () => {
    let requestBody;
    const cloud = {
        uid: 'user-a',
        server: 'https://old.example',
        groupCode: 'group-a',
        authGeneration: 1,
        loggedIn() { return true; }
    };
    const context = vm.createContext({
        Cloud: cloud,
        navigator: { onLine: true },
        DB: { async put() {} },
        cloudApi: async (_path, _method, body) => {
            requestBody = body;
            throw Object.assign(new Error('active group changed'), { status: 403 });
        },
        statsAnalyzeRoute() {
            return { distanceKm: 10, movingTimeSec: 1800, maxSpeed: 30, elevationGain: 500 };
        },
        groupJoined: true,
        groupInfo: { name: 'Group A' },
        fmtDur() { return '30 min'; },
        modal: async () => true,
        toast() {},
        console: { warn() {} }
    });
    const start = source.indexOf('async function shareRouteToGroupRanking(');
    const end = source.indexOf('\nasync function syncPendingGroupRankingDeletes(', start);
    vm.runInContext(
        `${source.slice(start, end)}\nglobalThis.shareRouteToGroupRanking = shareRouteToGroupRanking;`,
        context
    );
    const route = { id: 8, kind: 'recorded' };

    assert.equal(await context.shareRouteToGroupRanking(route, null), false);
    assert.equal(requestBody.groupId, 'group-a');
    assert.equal(route.groupRankingGroupId, 'group-a');
    assert.equal(route.groupRankingPending, true);
});

test('automatic ranking retries stay bound to the original owner and server', async () => {
    let requestCount = 0;
    const cloud = {
        uid: 'user-b',
        server: 'https://new.example',
        groupCode: 'group-a',
        authGeneration: 2,
        loggedIn() { return true; }
    };
    const context = vm.createContext({
        Cloud: cloud,
        navigator: { onLine: true },
        DB: { async put() { throw new Error('A mismatched retry must not be written.'); } },
        cloudApi: async () => { requestCount++; },
        groupJoined: true,
        toast() {},
        console: { warn() {} }
    });
    const start = source.indexOf('async function shareRouteToGroupRanking(');
    const end = source.indexOf('\nasync function syncPendingGroupRankingDeletes(', start);
    vm.runInContext(
        `${source.slice(start, end)}\nglobalThis.shareRouteToGroupRanking = shareRouteToGroupRanking;`,
        context
    );
    const route = {
        id: 8,
        kind: 'recorded',
        groupRankingOwnerId: 'user-a',
        groupRankingServer: 'https://old.example',
        groupRankingGroupId: 'group-a',
        groupRankingPending: true
    };

    const result = await context.shareRouteToGroupRanking(route, null, { automatic: true });

    assert.equal(result, false);
    assert.equal(requestCount, 0);
    assert.equal(route.groupRankingOwnerId, 'user-a');
    assert.equal(route.groupRankingServer, 'https://old.example');
});
