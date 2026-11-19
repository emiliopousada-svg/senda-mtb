'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const garage = require('../app/garage.js');
const statistics = require('../app/statistics-engine.js');
const root = path.join(__dirname, '..');

const day = (y, m, d, h = 10) => new Date(y, m - 1, d, h).toISOString();
const localDate = timestamp => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

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

test('cached route usage excludes imports and counts only rides after each maintenance entry', () => {
    const entries = [
        { id: 'revision', type: 'revision', date: '2026-01-01', at: new Date(2026, 0, 1).getTime() },
        { id: 'chain', type: 'chain', date: '2026-01-02', at: new Date(2026, 0, 2, 12).getTime() },
        { id: 'suspension', type: 'suspension', date: '2026-01-01', at: new Date(2026, 0, 1).getTime() },
        { id: 'brakes', type: 'brakes', date: '2026-01-02', at: new Date(2026, 0, 2, 12).getTime() }
    ].map(garage.garageNormalizeEntry);
    const routes = [
        { id: 1, kind: 'recorded', startedAt: day(2026, 1, 2), distanceKm: 100, movingTimeSec: 3600, testDescentM: 500, points: [[0, 0], [0, 0.001]] },
        { id: 2, kind: 'recorded', startedAt: day(2026, 1, 3), distanceKm: 50, movingTimeSec: 1800, testDescentM: 400, points: [[0, 0], [0, 0.001]] },
        { id: 3, kind: 'imported', startedAt: day(2026, 1, 4), distanceKm: 999, movingTimeSec: 90000, testDescentM: 9000, points: [[0, 0], [0, 0.001]] }
    ];
    let analyzed = 0;
    const usage = garage.garageBuildUsage(routes, entries, {
        analyzeRoute(route) {
            analyzed++;
            return { descentAvailable: true, descentM: route.testDescentM };
        }
    });
    assert.equal(analyzed, 2);
    assert.equal(usage.latestRouteId, 2);
    assert.equal(usage.totalKm, 150);
    assert.equal(usage.kmSinceRevision, 150);
    assert.equal(usage.componentKm.chain, 50);
    assert.equal(usage.suspensionMovingSec, 5400);
    assert.equal(usage.brakeDescentM, 400);
});

test('garage summary reads cached totals and resets when a service is backdated', () => {
    const state = garage.garageNormalizeState({
        intervalKm: 100,
        entries: [
            { id: 'revision', type: 'revision', date: '2026-01-02', at: new Date(2026, 0, 2, 12).getTime() },
            { id: 'chain', type: 'chain', date: '2026-01-02', at: new Date(2026, 0, 2, 12).getTime() }
        ],
        usage: {
            version: 1,
            totalKm: 250,
            kmSinceRevision: 100,
            componentKm: { chain: 75 }
        }
    });
    const summary = garage.garageSummary(state, []);
    assert.equal(summary.totalKm, 250);
    assert.equal(summary.kmSinceRevision, 100);
    assert.equal(summary.components[0].km, 75);

    const rebuilt = garage.garageBuildUsage([
        { id: 1, startedAt: day(2026, 1, 2, 10), distanceKm: 50 },
        { id: 2, startedAt: day(2026, 1, 3, 10), distanceKm: 50 }
    ], state.entries);
    assert.equal(rebuilt.totalKm, 100);
    assert.equal(rebuilt.kmSinceRevision, 50);
    assert.equal(rebuilt.componentKm.chain, 50);
});

test('preventive alerts distinguish approaching and reached usage thresholds', () => {
    const now = new Date(2026, 4, 15, 12).getTime();
    const entries = ['chain', 'suspension', 'brakes', 'tubeless'].map((type, index) => {
        const at = type === 'tubeless' ? new Date(2026, 0, 15, 12).getTime() : new Date(2026, 0, 1).getTime();
        return garage.garageNormalizeEntry({ id: String(index), type, date: localDate(at), at });
    });
    const state = garage.garageNormalizeState({
        entries,
        usage: {
            version: 1,
            componentKm: { chain: 1500 },
            suspensionMovingSec: 50 * 60 * 60,
            brakeDescentM: 15001
        }
    });
    const alerts = garage.garagePreventiveAlerts(state, now);
    assert.deepEqual(alerts.map(alert => [alert.type, alert.state]), [
        ['chain', 'due'],
        ['tubeless', 'due'],
        ['suspension', 'due'],
        ['brakes', 'due']
    ]);
    assert.match(alerts.find(alert => alert.type === 'brakes').message, /15\.001 m/);
    const brakeBoundary = garage.garagePreventiveAlerts({
        ...state,
        usage: { ...state.usage, brakeDescentM: 15000 }
    }, now);
    assert.equal(brakeBoundary.find(alert => alert.type === 'brakes').state, 'soon');

    const warningState = garage.garageNormalizeState({
        entries: entries.map(entry => entry.type === 'tubeless'
            ? { ...entry, at: new Date(2026, 1, 15, 12).getTime(), date: '2026-02-15' }
            : entry),
        usage: {
            version: 1,
            componentKm: { chain: 1200 },
            suspensionMovingSec: 40 * 60 * 60,
            brakeDescentM: 12000
        }
    });
    const warningAlerts = garage.garagePreventiveAlerts(warningState, now);
    assert.deepEqual(warningAlerts.map(alert => alert.state), ['soon', 'soon', 'soon', 'soon']);
});

test('preventive alerts ask for a baseline when service history is missing', () => {
    const alerts = garage.garagePreventiveAlerts(garage.garageNormalizeState({}), Date.now());
    assert.ok(alerts.every(alert => alert.state === 'unknown'));
});

test('route usage uses the shared statistics engine for descent totals', () => {
    const startedAt = Date.UTC(2026, 0, 1);
    const points = Array.from({ length: 12 }, (_, index) =>
        [0, index * 0.0003, 200 - index * 2, startedAt + index * 5000]);
    const entries = [garage.garageNormalizeEntry({
        id: 'brakes', type: 'brakes', date: '2025-12-31', at: startedAt - 1000
    })];
    const usage = garage.garageBuildUsage([{
        id: 1, kind: 'recorded', startedAt: new Date(startedAt).toISOString(), distanceKm: 1, points
    }], entries, statistics);
    assert.ok(usage.brakeDescentM > 10);
});

test('tools hub has Garage but no Senda AI, and the map has no food button', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const hub = html.match(/<section class="tools-hub"[\s\S]*?<\/section>/)[0];
    assert.match(hub, /data-tool="garage"/);
    assert.doesNotMatch(hub, /data-tool="ai"/);
    assert.doesNotMatch(html, /ai-preview|Senda AI|btn-poi-food/);
    assert.match(html, /id="garage-workspace"[\s\S]*id="garage-photo-input"[\s\S]*id="garage-form"/);
    assert.match(html, /id="garage-preventive-alerts"/);
    assert.ok(html.indexOf('app/garage.js') < html.indexOf('app/tools.js'));
    assert.equal(fs.existsSync(path.join(root, 'app', 'ai-preview.js')), false);
    const pois = fs.readFileSync(path.join(root, 'app', 'pois.js'), 'utf8');
    assert.doesNotMatch(pois, /btn-poi-food/);
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    assert.match(sw, /'app\/garage\.js'/);
    assert.match(sw, /'app\/tools\.js'/);
    assert.doesNotMatch(sw, /ai-preview/);
});
