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
    const timers = [];
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
        toast() {},
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout() {}
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud-preferences.js'), 'utf8'),
        context
    );
    return { context, values, calls, status, warnings, timers };
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
        adminToken: 'must not be kept'
    });

    assert.equal(preferences.routeSound, true);
    assert.equal(preferences.mapStyle, 'topographic');
    assert.equal(preferences.wheelCircumference, 2100);
    assert.equal(preferences.weeklyGoalKm, 100);
    assert.equal(preferences.maxHeartRate, null);
    assert.equal(preferences.ftpWatts, null);
    assert.deepEqual(preferences.recordingVisibleMetrics, ['speed', 'dist', 'elev', 'hr', 'moving']);
    assert.equal(Object.hasOwn(preferences, 'dashboardCardOrder'), false);
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
        recordingVisibleMetrics: ['power', 'unknown', 'power']
    });

    assert.equal(preferences.routeSound, false);
    assert.equal(preferences.mapStyle, 'osm');
    assert.equal(preferences.wheelCircumference, 2200);
    assert.equal(preferences.weeklyGoalKm, 50);
    assert.equal(preferences.maxHeartRate, 190);
    assert.equal(preferences.ftpWatts, 250);
    assert.equal(preferences.recordingMetricOrder[0], 'power');
    assert.equal(preferences.recordingMetricOrder.length, 8);
    assert.deepEqual(preferences.recordingVisibleMetrics, ['power']);
});

test('cloud preferences drop the retired total-time map metric', () => {
    const preferences = normalizePreferences({
        recordingMetricOrder: ['time', 'speed', 'dist'],
        recordingVisibleMetrics: ['speed', 'time', 'dist']
    });
    assert.equal(preferences.recordingMetricOrder.includes('time'), false);
    assert.equal(preferences.recordingMetricOrder[0], 'speed');
    assert.deepEqual(preferences.recordingVisibleMetrics, ['speed', 'dist']);
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

test('cloud preferences keep only valid, unique emergency contacts', () => {
    const preferences = normalizePreferences({
        safetyContacts: [
            { name: '  Ana  ', phone: '+34 600 123 456' },
            { name: 'Duplicado', phone: '+34600123456' },
            { name: '', phone: '+34600000001' },
            { name: 'Sin prefijo', phone: '0600123456' },
            { name: 'Luis', phone: '34611222333' },
            'texto',
            { name: 'C3', phone: '+34600000003' },
            { name: 'C4', phone: '+34600000004' },
            { name: 'C5', phone: '+34600000005' },
            { name: 'C6', phone: '+34600000006' }
        ]
    });
    assert.deepEqual(preferences.safetyContacts, [
        { name: 'Ana', phone: '+34600123456' },
        { name: 'Luis', phone: '+34611222333' },
        { name: 'C3', phone: '+34600000003' },
        { name: 'C4', phone: '+34600000004' },
        { name: 'C5', phone: '+34600000005' }
    ]);
    assert.deepEqual(normalizePreferences({}).safetyContacts, []);
});

test('signed-in sync restores the emergency contacts saved in the account', async () => {
    const contacts = [{ name: 'Ana', phone: '+34600123456' }];
    const { context, values } = preferencesSyncContext({
        api: async () => ({ items: [{ id: 'preferences-1', preferences: { safetyContacts: contacts } }] })
    });
    let applied = null;
    context.safetySetContacts = list => { applied = JSON.parse(JSON.stringify(list)); };

    assert.equal(await context.syncCloudPreferences(), true);
    assert.deepEqual(JSON.parse(values.get('mtb_pro_safety_contacts')), contacts);
    assert.deepEqual(applied, contacts);
});

test('first sync uploads the emergency contacts stored on the device', async () => {
    let createdRecord = null;
    const { context } = preferencesSyncContext({
        initialStorage: { mtb_pro_safety_contacts: JSON.stringify([{ name: 'Ana', phone: '+34600123456' }]) },
        api: async (path, method, body) => {
            if (method === 'POST') createdRecord = body;
            return method === 'POST' ? { id: 'created' } : { items: [] };
        }
    });

    assert.equal(await context.syncCloudPreferences(), true);
    assert.deepEqual(JSON.parse(JSON.stringify(createdRecord.preferences.safetyContacts)), [{ name: 'Ana', phone: '+34600123456' }]);
});

test('an older account record without contacts keeps device contacts and schedules an upload', async () => {
    const local = [{ name: 'Ana', phone: '+34600123456' }];
    const { context, values, timers } = preferencesSyncContext({
        initialStorage: {
            mtb_pro_safety_contacts: JSON.stringify(local),
            mtb_pro_preferences_owner: 'https://pb.example\nuser-1'
        },
        api: async () => ({ items: [{ id: 'preferences-1', preferences: { routeSound: false } }] })
    });

    assert.equal(await context.syncCloudPreferences(), true);
    assert.deepEqual(JSON.parse(values.get('mtb_pro_safety_contacts')), local);
    assert.equal(timers.length, 1);
});

test('switching accounts does not inherit the previous account emergency contacts', async () => {
    const { context, values, timers } = preferencesSyncContext({
        uid: 'user-2',
        initialStorage: {
            mtb_pro_safety_contacts: JSON.stringify([{ name: 'Ana', phone: '+34600123456' }]),
            mtb_pro_preferences_owner: 'https://pb.example\nuser-1'
        },
        api: async () => ({ items: [{ id: 'preferences-2', preferences: { routeSound: false } }] })
    });

    assert.equal(await context.syncCloudPreferences(), true);
    assert.deepEqual(JSON.parse(values.get('mtb_pro_safety_contacts')), []);
    assert.equal(timers.length, 0);
});

test('contacts added while signed out are merged with the account contacts and uploaded', async () => {
    const { context, values, timers } = preferencesSyncContext({
        uid: 'user-2',
        initialStorage: {
            mtb_pro_safety_contacts: JSON.stringify([{ name: 'Ana', phone: '+34600123456' }]),
            mtb_pro_safety_contacts_unsynced: '1',
            mtb_pro_preferences_owner: 'https://pb.example\nuser-1'
        },
        api: async () => ({ items: [{ id: 'preferences-2', preferences: {
            safetyContacts: [{ name: 'Luis', phone: '+34600999888' }, { name: 'Ana bis', phone: '+34600123456' }]
        } }] })
    });

    assert.equal(await context.syncCloudPreferences(), true);
    const phones = JSON.parse(values.get('mtb_pro_safety_contacts')).map(contact => contact.phone);
    assert.deepEqual(phones, ['+34600999888', '+34600123456']);
    assert.equal(timers.length, 1);
});

test('a local change made during the request is not overwritten by the account', async () => {
    const holder = {};
    holder.ctx = preferencesSyncContext({
        initialStorage: {
            mtb_pro_route_sound: 'true',
            mtb_pro_preferences_owner: 'https://pb.example\nuser-1'
        },
        api: async () => {
            const key = holder.ctx.context.cloudPreferencesPendingKey('user-1', 'https://pb.example');
            holder.ctx.values.set(key, JSON.stringify({ routeSound: true }));
            return { items: [{ id: 'preferences-1', preferences: { routeSound: false } }] };
        }
    });

    assert.equal(await holder.ctx.context.syncCloudPreferences(), true);
    assert.equal(holder.ctx.values.get('mtb_pro_route_sound'), 'true');
    assert.equal(holder.ctx.timers.length, 1);
});
