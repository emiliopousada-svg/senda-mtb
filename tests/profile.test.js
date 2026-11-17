'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
    for (const provider of ['Strava', 'Garmin Connect', 'Komoot', 'Apple Salud']) {
        assert.match(profilePage, new RegExp(`${provider}[\\s\\S]*Próximamente`));
    }
    assert.equal((profilePage.match(/class="profile-service-toggle" type="checkbox" disabled/g) || []).length, 4);
    assert.match(profilePage, /solo en este dispositivo y no se comparte automáticamente/);
    assert.match(source, /published = true/);
    assert.match(navigation, /profileRender\(\)[\s\S]*profileRefreshSharedRoutes\(\)/);
    assert.ok(html.indexOf('app/cloud.js') < html.indexOf('app/profile.js'));
    assert.match(worker, /'app\/profile\.js'/);
});
