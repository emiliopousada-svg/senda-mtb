'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'group-rankings.js'), 'utf8');
const start = source.indexOf('async function loadGroupRankings() {');
const end = source.indexOf('\nasync function shareRouteToGroupRanking', start);
const rankingLoaderSource = source.slice(start, end);

function rankingContext() {
    const state = {
        currentGroupId: 'group-a',
        refreshGroups: [],
        requests: [],
        status: {
            textContent: '',
            classList: {
                add(name) { state.status.error = name === 'error'; },
                remove(name) { if (name === 'error') state.status.error = false; }
            }
        }
    };
    const context = vm.createContext({
        $: id => id === 'group-ranking-status' ? state.status : null,
        Cloud: { loggedIn: () => true },
        groupJoined: true,
        groupName: () => state.currentGroupId,
        cloudApi: () => new Promise((resolve, reject) => state.requests.push({ resolve, reject })),
        renderGroupMetricRanking() {},
        renderGroupRankingPending() {},
        renderCommunityCompetitionStatus() {},
        refreshCommunityLeague() { state.refreshGroups.push(state.currentGroupId); },
        console: { warn() {} }
    });
    vm.runInContext(`let groupRankingMembers = [];\n${rankingLoaderSource}\nglobalThis.loadGroupRankings = loadGroupRankings;`, context);
    return { context, state };
}

test('active Community section reloads when group ranking request fails', async () => {
    const { context, state } = rankingContext();
    const loading = context.loadGroupRankings();

    state.requests[0].reject(new Error('offline'));
    await loading;

    assert.deepEqual(state.refreshGroups, ['group-a']);
    assert.match(state.status.textContent, /No se pudo cargar el ranking/);
    assert.equal(state.status.error, true);
});

test('stale ranking response refreshes the active group section instead of keeping it empty', async () => {
    const { context, state } = rankingContext();
    const loading = context.loadGroupRankings();

    state.currentGroupId = 'group-b';
    state.requests[0].resolve({ members: [] });
    await loading;

    assert.deepEqual(state.refreshGroups, ['group-b']);
    assert.equal(state.status.textContent, 'Cargando marcas del grupo…');
});
