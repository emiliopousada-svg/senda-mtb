'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const garage = require('../app/garage.js');
const root = path.join(__dirname, '..');

const day = (y, m, d, h = 10) => new Date(y, m - 1, d, h).toISOString();

test('garage state is normalized and sorted newest first', () => {
    const state = garage.garageNormalizeState({
        bikeName: '  Orbea Oiz  ',
        intervalKm: 'x',
        entries: [
            { id: 'a', type: 'chain', date: '2026-10-01', cost: '35.5' },
            { id: 'b', type: 'nope', date: '2026-11-01', cost: -4, notes: ' ok ' },
            { id: 'c', type: 'brakes', date: '2026-02-30' },
            null
        ]
    });
    assert.equal(state.bikeName, 'Orbea Oiz');
    assert.equal(state.intervalKm, 1000);
    assert.deepEqual(state.entries.map(entry => entry.id), ['b', 'a']);
    assert.equal(state.entries[0].type, 'other');
    assert.equal(state.entries[0].cost, 0);
    assert.equal(state.entries[0].notes, 'ok');
    assert.equal(state.entries[1].cost, 35.5);
});

test('maintenance done on a past day counts rides from the next day', () => {
    const now = new Date(2026, 10, 17, 12).getTime();
    const at = garage.garageEntryTime('2026-11-10', now);
    const rides = garage.garageRides([
        { startedAt: day(2026, 11, 10, 9), distanceKm: 20 },
        { startedAt: day(2026, 11, 11), distanceKm: 30 },
        { startedAt: day(2026, 11, 12), distanceKm: 15.5, kind: 'imported' }
    ]);
    assert.equal(garage.garageKmSince(rides, at), 30);
    assert.equal(garage.garageEntryTime('2026-11-17', now), now);
});

test('summary counts km since the last general revision and per component', () => {
    const state = garage.garageNormalizeState({
        intervalKm: 100,
        entries: [
            { id: 'r1', type: 'revision', date: '2026-09-01', at: new Date(2026, 8, 1, 23).getTime(), cost: 60 },
            { id: 'c1', type: 'chain', date: '2026-10-01', at: new Date(2026, 9, 1, 23).getTime(), cost: 30 }
        ]
    });
    const routes = [
        { startedAt: day(2026, 8, 20), distanceKm: 50 },
        { startedAt: day(2026, 9, 15), distanceKm: 40 },
        { startedAt: day(2026, 10, 5), distanceKm: 70 }
    ];
    const summary = garage.garageSummary(state, routes);
    assert.equal(summary.totalKm, 160);
    assert.equal(summary.costTotal, 90);
    assert.equal(summary.kmSinceRevision, 110);
    assert.equal(summary.remainingKm, -10);
    assert.equal(summary.progress, 1);
    assert.deepEqual(summary.components.map(item => [item.type, item.km]), [['chain', 70]]);
});

test('summary without revisions does not invent a countdown', () => {
    const summary = garage.garageSummary(garage.garageNormalizeState({}), [{ startedAt: day(2026, 1, 1), distanceKm: 10 }]);
    assert.equal(summary.lastRevision, null);
    assert.equal(summary.kmSinceRevision, null);
    assert.equal(summary.progress, 0);
});

test('tools hub has Garage but no Senda AI, and the map has no food button', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const hub = html.match(/<section class="tools-hub"[\s\S]*?<\/section>/)[0];
    assert.match(hub, /data-tool="garage"/);
    assert.doesNotMatch(hub, /data-tool="ai"/);
    assert.doesNotMatch(html, /ai-preview|Senda AI|btn-poi-food/);
    assert.match(html, /id="garage-workspace"[\s\S]*id="garage-photo-input"[\s\S]*id="garage-form"/);
    assert.ok(html.indexOf('app/garage.js') < html.indexOf('app/tools.js'));
    assert.equal(fs.existsSync(path.join(root, 'app', 'ai-preview.js')), false);
    const pois = fs.readFileSync(path.join(root, 'app', 'pois.js'), 'utf8');
    assert.doesNotMatch(pois, /btn-poi-food/);
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    assert.match(sw, /'app\/garage\.js'/);
    assert.match(sw, /'app\/tools\.js'/);
    assert.doesNotMatch(sw, /ai-preview/);
});
