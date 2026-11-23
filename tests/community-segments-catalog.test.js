'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-segments.js'), 'utf8');

function segmentContext() {
    const context = vm.createContext({
        $: () => null,
        communityRecordLines: segment => segment.geometry,
        communityDistanceToRoute: (_position, geometry) => geometry[0].distanceMeters
    });
    vm.runInContext(source, context);
    return context;
}

function segment(title, routeTitle, distanceMeters) {
    return {
        title,
        expand: { route: { title: routeTitle, locality: 'Galicia' } },
        geometry: [{ distanceMeters }]
    };
}

test('community segments are ordered by distance and retain their route name', () => {
    const context = segmentContext();
    const ordered = context.communityPrepareHubSegments([
        segment('Bajada', 'Ruta del valle', 1800),
        segment('Subida', 'Ruta del monte', 450)
    ], [42.4, -8.6]);

    assert.deepEqual(Array.from(ordered, item => [
        item.title, item.communityRouteTitle, item.communityRouteLocation, item.communityProximityMeters
    ]), [
        ['Subida', 'Ruta del monte', 'Galicia', 450],
        ['Bajada', 'Ruta del valle', 'Galicia', 1800]
    ]);
});

test('community segments fall back to route order without a GPS position', () => {
    const context = segmentContext();
    const ordered = context.communityPrepareHubSegments([
        segment('A', 'Ruta del valle', 100),
        segment('B', 'Ruta del monte', 900)
    ], null);

    assert.deepEqual(Array.from(ordered, item => [item.communityRouteTitle, item.communityProximityMeters]), [
        ['Ruta del monte', null],
        ['Ruta del valle', null]
    ]);
});

test('community segment distance labels use meters nearby and kilometers farther away', () => {
    const context = segmentContext();
    assert.equal(context.communityHubSegmentDistanceLabel(850), '850 m');
    assert.equal(context.communityHubSegmentDistanceLabel(1250), '1.3 km');
    assert.equal(context.communityHubSegmentDistanceLabel(null), '');
});

test('automatic scan only saves faster personal records and sends no activity track data', async () => {
    const context = segmentContext();
    const segments = [
        { id: 'segment-1', title: 'Bajada', geometry: [{ segmentId: 'segment-1' }] },
        { id: 'segment-2', title: 'Subida', geometry: [{ segmentId: 'segment-2' }] },
        { id: 'segment-3', title: 'Llanura', geometry: [{ segmentId: 'segment-3' }] }
    ];
    const calls = [];
    const stored = new Map();
    context.Cloud = {
        uid: 'user-1',
        server: 'https://cloud.example',
        authGeneration: 7,
        nickname: 'Ciclista',
        loggedIn: () => true
    };
    context.navigator = { onLine: true };
    context.savedRoutes = [{
        id: 'activity-1',
        points: [[40, -3, 100, 1_800_000_000_000], [40, -2.99, 100, 1_800_000_001_000]],
        segmentTimes: { 'segment-1': 50, 'segment-2': 80, 'segment-3': 120 }
    }, {
        id: 'imported-activity',
        kind: 'imported',
        points: [[40, -3, 100, 1_700_000_000_000], [40, -2.99, 100, 1_700_000_001_000]],
        segmentTimes: { 'segment-1': 10, 'segment-2': 10, 'segment-3': 10 }
    }];
    context.MTBCommunityPerformance = {
        matchActivity(activity, lines) {
            const elapsedSeconds = activity.segmentTimes[lines[0].segmentId];
            return { elapsedSeconds };
        }
    };
    context.communityRecordCollectionUrl = (collection, filter) =>
        `/api/collections/${collection}/records?filter=${encodeURIComponent(filter)}`;
    context.localStorage = {
        getItem: key => stored.get(key) || null,
        setItem: (key, value) => stored.set(key, value)
    };
    context.toast = () => {};
    context.cloudApi = async (url, method, payload) => {
        calls.push({ url, method, payload });
        if (url.startsWith('/api/collections/community_segments/records')) {
            return { items: segments, totalPages: 1 };
        }
        if (!method && url.startsWith('/api/collections/community_segment_efforts/records')) {
            return {
                items: [{ id: 'effort-1', owner: 'user-1', segment: 'segment-1', alias: 'Ciclista', elapsedSeconds: 60 },
                    { id: 'effort-3', owner: 'user-1', segment: 'segment-3', alias: 'Ciclista', elapsedSeconds: 100 }],
                totalPages: 1
            };
        }
        if (method === 'PATCH') return { id: 'effort-1', segment: 'segment-1', alias: payload.alias, elapsedSeconds: payload.elapsedSeconds };
        if (method === 'POST') return { id: 'effort-2', segment: payload.segment, alias: payload.alias, elapsedSeconds: payload.elapsedSeconds };
        throw new Error(`Unexpected request: ${method || 'GET'} ${url}`);
    };

    await context.communityScanAutomaticSegmentEfforts();

    const writes = calls.filter(call => call.method === 'PATCH' || call.method === 'POST');
    assert.equal(writes.length, 2);
    const update = writes.find(call => call.method === 'PATCH');
    assert.equal(update.url, '/api/collections/community_segment_efforts/records/effort-1');
    assert.deepEqual(Object.keys(update.payload).sort(), ['alias', 'elapsedSeconds']);
    assert.equal(update.payload.elapsedSeconds, 50);
    const create = writes.find(call => call.method === 'POST');
    assert.deepEqual(Object.keys(create.payload).sort(), ['alias', 'elapsedSeconds', 'owner', 'segment']);
    assert.equal(create.payload.segment, 'segment-2');
    assert.equal(create.payload.elapsedSeconds, 80);
    assert.ok(writes.every(call => !JSON.stringify(call.payload).includes('activity-1')));
    assert.ok(writes.every(call => !JSON.stringify(call.payload).includes('imported-activity')));
});

test('automatic scan is scheduled after downloaded routes are added to the library', () => {
    const cloud = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud.js'), 'utf8');
    assert.match(cloud, /if \(pulled > 0 && typeof communityScheduleAutomaticSegmentEffortScan === 'function'\)\s*\{\s*communityScheduleAutomaticSegmentEffortScan\(\);/);
});

test('automatic scan is scheduled after local route history is restored', () => {
    const cloud = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud.js'), 'utf8');
    assert.match(cloud, /savedRoutes = \(await DB\.all\(\)\)\.sort\(\(a, b\) => b\.id - a\.id\);\s*if \(typeof communityScheduleAutomaticSegmentEffortScan === 'function'\)\s*\{\s*communityScheduleAutomaticSegmentEffortScan\(\);/);
});

test('hub restarts its catalog load rather than mixing pages after a server change', async () => {
    const makeElement = () => ({
        children: [],
        listeners: {},
        classList: { add() {}, remove() {} },
        append(...elements) { this.children.push(...elements); },
        appendChild(element) { this.children.push(element); return element; },
        replaceChildren(...elements) { this.children = elements; },
        setAttribute() {},
        addEventListener(type, callback) { this.listeners[type] = callback; }
    });
    const elements = new Map([
        ['community-hub-segment-list', makeElement()],
        ['community-hub-segments-status', makeElement()],
        ['community-hub-segments-refresh', makeElement()]
    ]);
    let firstResponse;
    let calls = 0;
    let selectedSegment = null;
    const context = vm.createContext({
        $: id => elements.get(id) || null,
        document: {
            createElement: makeElement,
            createDocumentFragment: makeElement
        },
        Cloud: { server: 'https://server-a.example', uid: 'user-1', nickname: 'Rider' },
        navigator: { onLine: true },
        lastLat: null,
        lastLon: null,
        openCommunitySegmentMap: segment => { selectedSegment = segment; },
        requestCurrentGpsFix() {},
        communityRecordLines: segment => segment.geometry,
        communityDistanceToRoute: (_position, geometry) => geometry[0].distanceMeters
    });
    vm.runInContext(source, context);
    context.communityLoadHubSegmentRankings = () => {};
    context.communityScheduleAutomaticSegmentEffortScan = () => {};
    context.cloudApi = () => {
        calls++;
        if (calls === 1) return new Promise(resolve => { firstResponse = resolve; });
        return Promise.resolve({
            items: [segment('Actual', 'Ruta actual', 300)],
            totalPages: 1
        });
    };

    const oldLoad = context.communityLoadHubSegments();
    context.Cloud.server = 'https://server-b.example';
    firstResponse({
        items: [segment('Obsoleto', 'Ruta anterior', 100)],
        totalPages: 2
    });
    await oldLoad;
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(calls >= 2);
    assert.match(elements.get('community-hub-segments-status').textContent, /^1 segmentos/);
    const list = elements.get('community-hub-segment-list');
    assert.equal(list.children[0].children.length, 1);
    const findMapButton = node => {
        if (node.className === 'community-hub-segment-title-button') return node;
        for (const child of node.children || []) {
            const found = findMapButton(child);
            if (found) return found;
        }
        return null;
    };
    const mapButton = findMapButton(list);
    assert.ok(mapButton);
    assert.equal(mapButton.textContent, 'Actual');
    mapButton.listeners.click();
    assert.equal(selectedSegment && selectedSegment.title, 'Actual');
});
