'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const {
    profileBuildBadges,
    profileFormatDuration,
    profileNormalizeLocation,
    profileReadPerformance
} = require('../app/profile.js');

test('profile location is trimmed and limited to 80 characters', () => {
    assert.equal(profileNormalizeLocation('  Ponte Caldelas, Galicia  '), 'Ponte Caldelas, Galicia');
    assert.equal(profileNormalizeLocation(' x '.repeat(50)).length, 80);
    assert.equal(profileNormalizeLocation(null), '');
});

function profileLocationContext({ initialStorage = {}, response = null } = {}) {
    const storage = new Map(Object.entries(initialStorage));
    const elements = new Map([
        ['profile-location', { textContent: '' }],
        ['profile-location-input', { value: '' }],
        ['profile-editor-note', { textContent: '' }]
    ]);
    const calls = [];
    const context = vm.createContext({
        Cloud: {
            uid: 'user-1',
            token: 'token',
            loggedIn() { return true; },
            setSession(token, record) { this.token = token; this.record = record; }
        },
        document: {
            activeElement: null,
            getElementById: id => elements.get(id) || null
        },
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        navigator: { onLine: true },
        cloudApi: async (url, method, body) => {
            calls.push({ url, method, body });
            return response || { homeLocation: body.homeLocation, id: 'user-1' };
        },
        console: { warn() {} },
        toast() {}
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'app', 'profile.js'), 'utf8'), context);
    return { context, elements, storage, calls };
}

test('profile hydrates the account locality after login', () => {
    const { context, elements, storage } = profileLocationContext();
    context.profileApplyAccountLocation({ homeLocation: 'Ponte Caldelas, Galicia' });
    assert.equal(elements.get('profile-location').textContent, 'Ponte Caldelas, Galicia');
    assert.equal(elements.get('profile-location-input').value, 'Ponte Caldelas, Galicia');
    assert.equal(storage.get('mtb_pro_profile_location_user_user-1'), 'Ponte Caldelas, Galicia');
});

test('profile syncs a queued locality to the signed-in account', async () => {
    const { context, elements, storage, calls } = profileLocationContext({
        initialStorage: { 'mtb_pro_profile_location_pending_user-1': 'Ponte Caldelas, Galicia' }
    });
    await context.profileSyncPendingLocation('user-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/collections/users/records/user-1');
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].body.homeLocation, 'Ponte Caldelas, Galicia');
    assert.equal(storage.has('mtb_pro_profile_location_pending_user-1'), false);
    assert.equal(storage.get('mtb_pro_profile_location'), 'Ponte Caldelas, Galicia');
    assert.equal(elements.get('profile-location').textContent, 'Ponte Caldelas, Galicia');
});

test('profile migrates a saved device locality to the first signed-in account', async () => {
    const { context, storage, calls } = profileLocationContext({
        initialStorage: { mtb_pro_profile_location: 'Ponte Caldelas, Galicia' }
    });
    context.profileApplyAccountLocation({ homeLocation: '' });
    await context.profileSyncPendingLocation('user-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.homeLocation, 'Ponte Caldelas, Galicia');
    assert.equal(storage.get('mtb_pro_profile_location_owner'), 'user-1');
});

test('profile does not carry a different account locality into a new account', () => {
    const { context, elements, storage, calls } = profileLocationContext({
        initialStorage: {
            mtb_pro_profile_location: 'Ponte Caldelas, Galicia',
            mtb_pro_profile_location_owner: 'user-2'
        }
    });
    context.profileApplyAccountLocation({ homeLocation: '' });
    assert.equal(elements.get('profile-location').textContent, 'Añade tu localidad habitual');
    assert.equal(storage.has('mtb_pro_profile_location_pending_user-1'), false);
    assert.equal(calls.length, 0);
});

test('profile keeps an unconfirmed locality queued when the server does not save it', async () => {
    const pendingKey = 'mtb_pro_profile_location_pending_user-1';
    const { context, storage } = profileLocationContext({
        initialStorage: { [pendingKey]: 'Ponte Caldelas, Galicia' },
        response: { homeLocation: '' }
    });
    await assert.rejects(context.profileSyncPendingLocation('user-1'), /no confirmó la localidad/);
    assert.equal(storage.get(pendingKey), 'Ponte Caldelas, Galicia');
});

test('profile achievements only unlock from recorded mileage and elevation', () => {
    assert.deepEqual(profileBuildBadges({ rideCount: 0, distanceKm: 0, ascentM: 0, ascentSampleCount: 0 }), []);
    assert.deepEqual(profileBuildBadges({ rideCount: 1, distanceKm: 100, ascentM: 9999, ascentSampleCount: 1 })
        .map(badge => badge.title), ['Primera ruta', '100 km']);
    assert.deepEqual(profileBuildBadges({ rideCount: 12, distanceKm: 1200, ascentM: 10000, ascentSampleCount: 1 })
        .map(badge => badge.title), ['Primera ruta', '100 km', '1.000 km', '10.000 m+']);
    assert.deepEqual(profileBuildBadges({ rideCount: 3, distanceKm: 20, ascentM: 15000, ascentSampleCount: 0 })
        .map(badge => badge.title), ['Primera ruta']);
});

test('profile performance values validate configured thresholds and prefer age-based heart rate', () => {
    const values = new Map([
        ['mtb_pro_stats_age', '34'],
        ['mtb_pro_stats_hr_max', '200'],
        ['mtb_pro_stats_ftp', '250']
    ]);
    const storage = { getItem: key => values.has(key) ? values.get(key) : null };
    assert.deepEqual(profileReadPerformance(storage), { heartRateMax: 186, ftp: 250 });

    values.set('mtb_pro_stats_age', '101');
    values.set('mtb_pro_stats_hr_max', '99');
    values.set('mtb_pro_stats_ftp', '900');
    assert.deepEqual(profileReadPerformance(storage), { heartRateMax: null, ftp: null });
});

test('profile duration uses moving time as whole hours and minutes', () => {
    assert.equal(profileFormatDuration(0), '0 h 0 min');
    assert.equal(profileFormatDuration(3660), '1 h 1 min');
});

test('profile renders account-backed identity and keeps unavailable social services explicit', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const source = fs.readFileSync(path.join(root, 'app', 'profile.js'), 'utf8');
    const navigation = fs.readFileSync(path.join(root, 'app', 'navigation.js'), 'utf8');
    const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const pageStart = html.indexOf('<div class="page content-panel" id="page-settings">');
    const pageEnd = html.indexOf('<!-- INICIO / DASHBOARD senda-mtb -->', pageStart);
    const profilePage = html.slice(pageStart, pageEnd);

    for (const id of [
        'profile-avatar-image', 'profile-name', 'profile-location', 'profile-total-distance',
        'profile-total-ascent', 'profile-total-time', 'profile-bike-image', 'profile-achievements',
        'profile-hr-max', 'profile-ftp', 'profile-followers-count', 'profile-following-count',
        'profile-shared-routes-count'
    ]) assert.ok(profilePage.includes(`id="${id}"`), `${id} must be present in Profile`);
    for (const provider of ['Garmin Connect', 'Komoot', 'Apple Salud']) {
        assert.match(profilePage, new RegExp(`${provider}[\\s\\S]*Próximamente`));
    }
    assert.doesNotMatch(profilePage, /Strava|Herramientas → Social/);
    assert.equal((profilePage.match(/class="profile-service-toggle" type="checkbox" disabled/g) || []).length, 3);
    assert.match(profilePage, /Se guarda en tu cuenta si has iniciado sesión/);
    assert.match(source, /published = true/);
    assert.match(navigation, /profileRender\(\)[\s\S]*profileRefreshSharedRoutes\(\)/);
    assert.ok(html.indexOf('app/cloud.js') < html.indexOf('app/profile.js'));
    assert.match(worker, /'app\/profile\.js'/);
});
