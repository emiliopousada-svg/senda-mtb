'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function normalizePreferences(value) {
    const context = vm.createContext({ console: { warn() {} } });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud-preferences.js'), 'utf8'),
        context
    );
    return JSON.parse(JSON.stringify(context.normalizeCloudPreferences(value)));
}

function preferencesSyncContext({ api, initialStorage = {}, online = true, uid = 'user-1' }) {
    const values = new Map(Object.entries(initialStorage));
    const calls = [];
    const status = { textContent: '' };
    const warnings = [];
    const context = vm.createContext({
        localStorage: {
            getItem(key) { return values.has(key) ? values.get(key) : null; },
            setItem(key, value) { values.set(key, String(value)); },
            removeItem(key) { values.delete(key); }
        },
        navigator: { onLine: online },
        Cloud: { loggedIn: () => true, uid, server: 'https://pb.example' },
        document: {
            documentElement: { classList: { toggle() {} } },
            getElementById() { return null; },
            querySelectorAll() { return []; }
        },
        $: id => id === 'acc-preferences-status' ? status : null,
        cloudApi: async (...args) => {
            calls.push(args);
            return api(...args);
        },
        console: { warn(...args) { warnings.push(args.map(value => String(value))); } },
        toast() {}
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud-preferences.js'), 'utf8'),
        context
    );
    return { context, values, calls, status, warnings };
}

test('cloud preferences reject invalid values and fill safe defaults', () => {
    const preferences = normalizePreferences({
        routeSound: 'false',
        mapStyle: 'javascript:alert(1)',
        wheelCircumference: 4000,
        weeklyGoalKm: 1001,
        maxHeartRate: 99,
        ftpWatts: 900,
        recordingVisibleMetrics: [],
        dashboardCardOrder: { 'dashboard-main-grid': ['unknown-panel'] },
        adminToken: 'must not be kept'
    });

    assert.equal(preferences.routeSound, true);
    assert.equal(preferences.mapStyle, 'topographic');
    assert.equal(preferences.wheelCircumference, 2100);
    assert.equal(preferences.weeklyGoalKm, 100);
    assert.equal(preferences.maxHeartRate, null);
    assert.equal(preferences.ftpWatts, null);
    assert.deepEqual(preferences.recordingVisibleMetrics, ['speed', 'dist', 'elev', 'hr', 'moving', 'time']);
    assert.deepEqual(preferences.dashboardCardOrder['dashboard-main-grid'], ['dashboard-map-panel', 'dashboard-performance-panel']);
    assert.equal(Object.hasOwn(preferences, 'adminToken'), false);
});

test('cloud preferences preserve valid false values and normalize ordered lists', () => {
    const preferences = normalizePreferences({
        routeSound: false,
        mapStyle: 'osm',
        wheelCircumference: 2200,
        weeklyGoalKm: 50,
        maxHeartRate: 190,
        ftpWatts: 250,
        recordingMetricOrder: ['power', 'power', 'unknown'],
        recordingVisibleMetrics: ['power', 'unknown', 'power'],
        dashboardCardOrder: { 'dashboard-main-grid': ['dashboard-performance-panel'] }
    });

    assert.equal(preferences.routeSound, false);
    assert.equal(preferences.mapStyle, 'osm');
    assert.equal(preferences.wheelCircumference, 2200);
    assert.equal(preferences.weeklyGoalKm, 50);
    assert.equal(preferences.maxHeartRate, 190);
    assert.equal(preferences.ftpWatts, 250);
    assert.equal(preferences.recordingMetricOrder[0], 'power');
    assert.equal(preferences.recordingMetricOrder.length, 9);
    assert.deepEqual(preferences.recordingVisibleMetrics, ['power']);
    assert.deepEqual(preferences.dashboardCardOrder['dashboard-main-grid'], ['dashboard-performance-panel', 'dashboard-map-panel']);
});

test('signed-in sync applies the owner preferences returned by PocketBase', async () => {
    const { context, values, calls, status } = preferencesSyncContext({
        api: async () => ({
            items: [{ id: 'preferences-1', preferences: { routeSound: false, mapStyle: 'osm', weeklyGoalKm: 45 } }]
        })
    });

    assert.equal(await context.syncCloudPreferences(), true);
    assert.match(calls[0][0], /api\/collections\/mtb_user_preferences\/records/);
    assert.equal(values.get('mtb_pro_route_sound'), '0');
    assert.equal(values.get('mtb_pro_map_style'), 'osm');
    assert.equal(values.get('mtb_pro_weekly_goal_km'), '45');
    assert.equal(values.get('mtb_pro_preferences_owner'), 'https://pb.example\nuser-1');
    assert.equal(status.textContent, 'Ajustes sincronizados con PocketBase.');
});

test('first sync creates a private preference record without device location data', async () => {
    let createdRecord = null;
    const { context, calls, warnings } = preferencesSyncContext({
        initialStorage: {
            mtb_pro_route_sound: '0',
            mtb_pro_map_style: 'satellite',
            mtb_pro_last_pos: '[12.5,103.9]'
        },
        api: async (path, method, body) => {
            if (method === 'POST') createdRecord = { path, body };
            return method === 'POST' ? { id: 'created' } : { items: [] };
        }
    });

    assert.equal(await context.syncCloudPreferences(), true, JSON.stringify(warnings));
    assert.equal(calls.length, 2);
    assert.equal(createdRecord.body.owner, 'user-1');
    assert.equal(createdRecord.body.preferences.routeSound, false);
    assert.equal(createdRecord.body.preferences.mapStyle, 'satellite');
    assert.equal(Object.hasOwn(createdRecord.body.preferences, 'mtb_pro_last_pos'), false);
});

test('offline preference sync makes no PocketBase request', async () => {
    const { context, calls, status } = preferencesSyncContext({
        online: false,
        api: async () => { throw new Error('should not be called'); }
    });

    assert.equal(await context.syncCloudPreferences(), false);
    assert.equal(calls.length, 0);
    assert.equal(status.textContent, 'Ajustes guardados en este dispositivo; la sincronización está pendiente.');
});
