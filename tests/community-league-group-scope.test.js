'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-league.js'), 'utf8');

function makeElement() {
    return {
        children: [],
        className: '',
        hidden: false,
        style: {},
        classList: { toggle() {}, add() {}, remove() {} },
        append(...nodes) { this.children.push(...nodes); },
        appendChild(node) { this.children.push(node); return node; },
        replaceChildren(...nodes) { this.children = nodes; },
        addEventListener() {},
        setAttribute() {},
        reset() {}
    };
}

function awardsResult(groupId, nickname) {
    return {
        group: { id: groupId, name: groupId.toUpperCase() },
        current: {
            season: { seasonNumber: 8, daysRemaining: 3 },
            titles: [{
                key: 'champion',
                icon: '🏆',
                name: 'Campeón',
                description: '',
                winner: { nickname, value: '40 puntos' }
            }]
        },
        history: [],
        medalTable: [],
        challengeMedals: []
    };
}

function textContent(node) {
    return `${node.textContent || ''}${(node.children || []).map(textContent).join('')}`;
}

function leagueContext() {
    const elements = new Map();
    const getElement = id => {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
    };
    const tab = { dataset: { communitySection: 'achievements' } };
    const cloud = {
        groupCode: 'group-a',
        server: 'https://cloud.example',
        uid: 'user-1',
        authGeneration: 1,
        loggedIn() { return true; }
    };
    const requests = [];
    const context = vm.createContext({
        $: getElement,
        document: {
            createElement: makeElement,
            querySelector(selector) {
                if (selector === '[data-community-section].active') return tab;
                return makeElement();
            }
        },
        Cloud: cloud,
        groupJoined: true,
        groupName: () => cloud.groupCode,
        currentPage: 2,
        cloudApi: async () => new Promise(resolve => {
            requests.push({ groupId: cloud.groupCode, resolve });
        }),
        renderCommunityCompetitionStatus() {},
        console: { warn() {} },
        toast() {},
        navigator: { onLine: true },
        Date
    });
    vm.runInContext(source + '\nglobalThis.loadLeagueAwards = loadLeagueAwards;\nglobalThis.refreshCommunityLeague = refreshCommunityLeague;\nglobalThis.testLeagueState = leagueState;', context);
    return { context, cloud, elements, requests };
}

test('switching groups clears old titles and ignores a late response from the prior group', async () => {
    const { context, cloud, elements, requests } = leagueContext();

    const oldRequest = context.loadLeagueAwards(true);
    cloud.groupCode = 'group-b';
    const currentRequest = context.refreshCommunityLeague();

    assert.equal(requests.length, 2);
    requests[1].resolve(awardsResult('group-b', 'Ciclista B'));
    await currentRequest;
    requests[0].resolve(awardsResult('group-a', 'Ciclista A'));
    await oldRequest;

    const titles = elements.get('league-current-titles');
    assert.match(textContent(titles), /Ciclista B/);
    assert.doesNotMatch(textContent(titles), /Ciclista A/);
    assert.match(elements.get('league-awards-status').textContent, /^GROUP-B · Temporada/);
    assert.equal(context.testLeagueState.awards.groupId, 'group-b');
});

test('awards response for a different group is rejected', async () => {
    const { context, elements, requests } = leagueContext();
    const pending = context.loadLeagueAwards(true);
    requests[0].resolve(awardsResult('group-b', 'Ciclista B'));
    await pending;

    assert.equal((elements.get('league-current-titles') || { children: [] }).children.length, 0);
    assert.match(elements.get('league-awards-status').textContent, /datos de otro grupo/);
    assert.equal(context.testLeagueState.awards.groupId, '');
});
