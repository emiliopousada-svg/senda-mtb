'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadDuplicateFinder(api) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-routes.js'), 'utf8');
    const start = source.indexOf('async function communityFindPublishedDuplicate');
    const end = source.indexOf('async function submitCommunityRoute');
    const context = vm.createContext({ Cloud: { uid: 'user123' }, cloudApi: api });
    vm.runInContext(source.slice(start, end), context);
    return context;
}

test('publishing looks up an earlier publication of the same ride by the same owner', async () => {
    const calls = [];
    const context = loadDuplicateFinder(async url => { calls.push(url); return { items: [{ id: 'abc' }] }; });
    const found = await context.communityFindPublishedDuplicate({ distanceKm: 42.3, movingTimeSec: 7200 });
    assert.equal(found.id, 'abc');
    const filter = decodeURIComponent(calls[0].split('filter=')[1]);
    assert.match(filter, /owner = "user123"/);
    assert.match(filter, /movingTimeSec = 7200/);
    assert.match(filter, /distanceKm >= 42\.250/);
    assert.match(filter, /distanceKm <= 42\.350/);
});

test('routes without moving time are left to the server duplicate check', async () => {
    const context = loadDuplicateFinder(async () => { throw new Error('should not query'); });
    assert.equal(await context.communityFindPublishedDuplicate({ distanceKm: 10, movingTimeSec: 0 }), null);
});

test('the server duplicate rejection is recognised', () => {
    const context = loadDuplicateFinder(async () => ({ items: [] }));
    assert.equal(context.communityIsDuplicateError({ status: 400, message: 'Esta ruta ya está publicada en la comunidad.' }), true);
    assert.equal(context.communityIsDuplicateError({ status: 400, message: 'Otro error' }), false);
});
