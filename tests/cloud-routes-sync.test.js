'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud-routes-sync.js'), 'utf8')
    .replace(/\r\n/g, '\n');

function functionSource(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
    assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
    return source.slice(start, end);
}

function routeFormContext(maxBytes = 26214400) {
    return vm.createContext({
        ACTIVITY_TYPES: { mtb: {} },
        Blob,
        Cloud: { uid: 'user-a' },
        DB: { async loadRoutePhotos(route) { return route; } },
        FormData,
        ROUTE_NICKNAME_LIMIT: 32,
        ROUTE_TRACK_MAX_BYTES: maxBytes,
        activityTypeFromName: () => null,
        routePoisForSync: async pois => pois
    });
}

test('private route sync carries description, photo POIs, activity type, and points', async () => {
    const context = routeFormContext();
    vm.runInContext(
        `${functionSource('async function routeForm(', '\nasync function flushPendingDeletes')}\nglobalThis.testRouteForm = routeForm;`,
        context
    );

    const form = await context.testRouteForm({
        id: 21,
        name: 'MTB loop',
        kind: 'recorded',
        activityType: 'mtb',
        description: 'Sunrise ride',
        points: [[1, 2, 100]],
        pois: [{ lat: 1, lng: 2, caption: 'Photo', photoData: 'encoded-photo' }]
    });
    const track = JSON.parse(await form.get('track').text());

    assert.equal(form.get('activityType'), 'mtb');
    assert.equal(track.format, 2);
    assert.equal(track.description, 'Sunrise ride');
    assert.equal(track.pois[0].caption, 'Photo');
    assert.deepEqual(Array.from(track.points[0]), [1, 2, 100]);
});

test('remote track normalization preserves imported cumulative elevation values', () => {
    const context = vm.createContext({});
    vm.runInContext(
        `${functionSource('function normalizeRemoteTrack(', '\nfunction getRouteNickname')}\nglobalThis.testNormalizeRemoteTrack = normalizeRemoteTrack;`,
        context
    );

    const normalized = context.testNormalizeRemoteTrack([
        [42, -8, 100, null, null, null, null, null, null, 235],
        [42.001, -8, 105, null, null, null, null, null, null, 240]
    ]);

    assert.equal(normalized[0][9], 235);
});

test('private route sync rejects tracks larger than the server file limit', async () => {
    const context = routeFormContext(16);
    vm.runInContext(
        `${functionSource('async function routeForm(', '\nasync function flushPendingDeletes')}\nglobalThis.testRouteForm = routeForm;`,
        context
    );

    await assert.rejects(
        context.testRouteForm({ id: 22, points: [[1, 2, 'a long value that exceeds this test limit']] }),
        /límite de 25 MiB/
    );
});

test('private route metadata parser supports the new format and legacy point arrays', () => {
    const context = vm.createContext({
        normalizeRemoteTrack(value) {
            if (Array.isArray(value)) return value;
            return value && Array.isArray(value.points) ? value.points : null;
        },
        routePoisFromSync(pois) { return (Array.isArray(pois) ? pois : []).map(poi => ({ ...poi, photo: 'blob' })); }
    });
    vm.runInContext(
        `${functionSource('function routeDataFromSync(', '\nasync function putLocal')}\nglobalThis.testRouteDataFromSync = routeDataFromSync;`,
        context
    );

    const legacy = context.testRouteDataFromSync([[1, 2], [3, 4]]);
    const current = context.testRouteDataFromSync({
        format: 2,
        points: [[5, 6], [7, 8]],
        description: 'Private note',
        pois: [{ lat: 5, lng: 6, caption: 'Viewpoint' }]
    });

    assert.equal(legacy.hasPrivateMetadata, false);
    assert.equal(legacy.description, null);
    assert.equal(current.hasPrivateMetadata, true);
    assert.equal(current.description, 'Private note');
    assert.equal(current.pois[0].photo, 'blob');
});
