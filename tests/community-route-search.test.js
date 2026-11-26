'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function makeElement() {
    return {
        children: [],
        dataset: {},
        classList: { toggle() {} },
        addEventListener() {},
        add(element) { this.children.push(element); },
        append(...elements) { this.children.push(...elements); },
        appendChild(element) { this.children.push(element); return element; },
        replaceChildren(...elements) { this.children = elements; },
        setAttribute() {},
        focus() {},
        value: '',
        textContent: ''
    };
}

function communityContext(overrides = {}) {
    const elements = new Map();
    const getElement = id => {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
    };
    const context = vm.createContext({
        $: getElement,
        document: {
            createElement: makeElement,
            addEventListener() {}
        },
        Option: class Option {
            constructor(text, value) {
                this.text = text;
                this.value = value;
            }
        },
        ACTIVITY_TYPES: {
            mtb: { icon: '🚵', label: 'MTB' },
        },
        Cloud: { loggedIn: () => false, uid: '', server: '', authGeneration: 0 },
        navigator: { onLine: true },
        DB: { kvGet: async () => null, kvSet: async () => {} },
        communityRecordLines: record => record.lines || [[40, -3], [40, -2.99]],
        communityPoisFromRecord: () => [],
        communityBeginSegmentCreation() {},
        communityCancelSegmentCreation() {},
        communitySubmitSegment() {},
        ...overrides
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'statistics-engine.js'), 'utf8'),
        context
    );
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'community-routes.js'), 'utf8'),
        context
    );
    return { context, elements, getElement };
}

test('community search uses a real autonomy dropdown without a locality field', () => {
    const { elements, getElement } = communityContext();
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    assert.doesNotMatch(html, /community-locality-search/);
    assert.match(html, /select id="community-autonomous-community-search"/);
    const options = elements.get('community-autonomous-community-search').children;
    assert.equal(options.length, 20);
    assert.equal(options[0].value, '');
    assert.ok(options.some(option => option.value === 'Galicia'));
    assert.deepEqual(
        getElement('community-activity').children.map(option => option.value),
        ['', 'mtb']
    );
});

test('community routes render all supplied results and keep the global published total', () => {
    const { context, getElement } = communityContext();
    vm.runInContext('communityPublishedTotal = 63', context);

    context.renderCommunityRoutes(Array.from({ length: 25 }, (_, index) => ({
        id: `route-${index}`,
        title: `Route ${index}`,
        trackJson: '[[[40,-3],[40,-2.99]]]'
    })));

    assert.equal(getElement('community-route-list').children.length, 25);
    assert.equal(getElement('routes-count-community').textContent, '63');
});

test('community author search uses the normalized nickname and counts all published routes', async () => {
    const requests = [];
    const { context, getElement } = communityContext({
        Cloud: {
            loggedIn: () => true,
            uid: 'user-1',
            server: 'https://server.example',
            authGeneration: 2
        },
        requireSignedIn: () => true,
        lastLat: null,
        lastLon: null,
        cloudApi: async url => {
            requests.push(url);
            const decoded = decodeURIComponent(url);
            if (url.includes('&fields=id&')) return { totalItems: 47 };
            if (decoded.includes('/api/collections/community_routes/records?page=1&perPage=100')) {
                return { items: [], totalPages: 1 };
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    });

    getElement('community-autonomous-community-search').value = 'Galicia';
    getElement('community-author-search').value = '  EMILIO  ';

    await context.loadCommunityRoutes();
    await context.refreshCommunityPublishedCount();

    const searchRequest = requests.find(url => decodeURIComponent(url).includes('owner.nicknameKey'));
    assert.ok(searchRequest);
    assert.match(decodeURIComponent(searchRequest), /owner\.nicknameKey ~ "emilio"/);
    assert.match(decodeURIComponent(searchRequest), /province = "Galicia"/);
    assert.match(decodeURIComponent(searchRequest), /province = "A Coruña"/);
    assert.doesNotMatch(decodeURIComponent(searchRequest), /locality\s*~/);
    const countRequest = requests.find(url => url.includes('&fields=id&'));
    assert.ok(countRequest);
    assert.match(countRequest, /page=1&perPage=1/);
    assert.match(decodeURIComponent(countRequest), /filter=published = true/);
    assert.equal(getElement('routes-count-community').textContent, '47');
});

test('empty community-only search names the community without claiming a radius', async () => {
    const { context, getElement } = communityContext({
        Cloud: {
            loggedIn: () => true,
            uid: 'user-1',
            server: 'https://server.example',
            authGeneration: 2
        },
        requireSignedIn: () => true,
        lastLat: null,
        lastLon: null,
        cloudApi: async url => url.includes('&fields=id&')
            ? { totalItems: 0 }
            : { items: [], totalPages: 1 }
    });
    getElement('community-autonomous-community-search').value = 'Galicia';

    await context.loadCommunityRoutes();

    const status = getElement('community-modal-status').textContent;
    assert.match(status, /Galicia/);
    assert.match(status, /No hay rutas publicadas/);
    assert.doesNotMatch(status, /km/);
});

test('community search cache is isolated by its source server', async () => {
    const cache = {
        server: 'https://old-server.example',
        activity: '',
        radiusKm: 25,
        community: 'Galicia',
        author: '',
        difficulty: '',
        minAscent: 0,
        savedAt: Date.now(),
        routes: [{ id: 'old-route' }]
    };
    const { context } = communityContext({
        Cloud: { server: 'https://new-server.example' },
        DB: { kvGet: async () => cache }
    });
    const readCache = context.readCommunitySearchCache;
    const mismatched = await readCache('', 25, null, 'Galicia', '', '', 0, 'https://new-server.example');
    const matched = await readCache('', 25, null, 'Galicia', '', '', 0, 'https://old-server.example');

    assert.equal(mismatched, null);
    assert.equal(matched.routes[0].id, 'old-route');
});

test('community search drops a late response after the server context changes', async () => {
    let resolveMetadata;
    let markSearchStarted;
    const searchStarted = new Promise(resolve => { markSearchStarted = resolve; });
    const cacheWrites = [];
    const { context, getElement } = communityContext({
        Cloud: {
            loggedIn: () => true,
            uid: 'user-1',
            server: 'https://server-a.example',
            authGeneration: 1
        },
        requireSignedIn: () => true,
        lastLat: null,
        lastLon: null,
        DB: {
            kvGet: async () => null,
            kvSet: async (key, value) => cacheWrites.push({ key, value })
        },
        cloudApi: async url => {
            if (url.includes('perPage=1&fields=id')) return { totalItems: 0 };
            if (url.includes('page=1&perPage=100')) {
                markSearchStarted();
                return new Promise(resolve => { resolveMetadata = resolve; });
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    });
    getElement('community-autonomous-community-search').value = 'Galicia';

    const pendingSearch = context.loadCommunityRoutes();
    let startTimeout;
    const started = await Promise.race([
        searchStarted.then(() => true),
        new Promise(resolve => { startTimeout = setTimeout(() => resolve(false), 1000); })
    ]);
    clearTimeout(startTimeout);
    assert.equal(started, true, 'Community metadata search did not start');
    context.Cloud.server = 'https://server-b.example';
    context.Cloud.authGeneration = 2;
    resolveMetadata({ items: [], totalPages: 1 });

    assert.equal(await pendingSearch, false);
    assert.equal(cacheWrites.some(write => write.key === 'community-nearby-search-v4'), false);
});

test('a current offline search re-enables the button without letting a stale search control it', async () => {
    let resolveMetadata;
    let markSearchStarted;
    const searchStarted = new Promise(resolve => { markSearchStarted = resolve; });
    const { context, getElement } = communityContext({
        Cloud: {
            loggedIn: () => true,
            uid: 'user-1',
            server: 'https://server.example',
            authGeneration: 1
        },
        requireSignedIn: () => true,
        lastLat: null,
        lastLon: null,
        cloudApi: async url => {
            if (url.includes('perPage=1&fields=id')) return { totalItems: 0 };
            if (url.includes('page=1&perPage=100')) {
                markSearchStarted();
                return new Promise(resolve => { resolveMetadata = resolve; });
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    });
    getElement('community-autonomous-community-search').value = 'Galicia';

    const onlineSearch = context.loadCommunityRoutes();
    let startTimeout;
    const started = await Promise.race([
        searchStarted.then(() => true),
        new Promise(resolve => { startTimeout = setTimeout(() => resolve(false), 1000); })
    ]);
    clearTimeout(startTimeout);
    assert.equal(started, true, 'Community metadata search did not start');
    assert.equal(getElement('community-search').disabled, true);

    context.navigator.onLine = false;
    assert.equal(await context.loadCommunityRoutes(), false);
    assert.equal(getElement('community-search').disabled, false);

    resolveMetadata({ items: [], totalPages: 1 });
    assert.equal(await onlineSearch, false);
    assert.equal(getElement('community-search').disabled, false);
});

test('community publication refreshes its total even when local persistence fails', async () => {
    const calls = [];
    const { context, getElement } = communityContext({
        Cloud: { loggedIn: () => true, uid: 'user-1', nickname: 'Rider' },
        DB: {
            kvGet: async () => null,
            kvSet: async () => {},
            async put() {
                calls.push('persist');
                throw new Error('storage unavailable');
            }
        },
        FormData: class FormData {
            append() {}
        },
        communityPublicPoiData: () => ({ json: '[]', skipped: 0, count: 0 }),
        communityPerformedDate: () => null,
        communityUploadTrack: () => [[[40, -3, 100], [40.001, -3, 110]]],
        activityTypeForRoute: () => 'mtb',
        cloudApi: async () => ({ id: 'published-route' }),
        setTimeout: () => 0,
        toast() {},
        console: { warn() {} }
    });
    const order = [];
    context.refreshCalls = order;
    context.testUploadTrack = () => [[[40, -3, 100], [40.001, -3, 110]]];
    context.testPublicPoiData = () => ({ json: '[]', skipped: 0, count: 0 });
    vm.runInContext(
        'refreshCommunityPublishedCount = () => refreshCalls.push("count"); communityUploadTrack = testUploadTrack; communityPublicPoiData = testPublicPoiData;',
        context
    );
    context.renderSavedRoutes = () => order.push('render');
    const route = { id: 8, name: 'Ridge', points: [] };
    context.testRoute = route;
    vm.runInContext('communityShareRoute = testRoute', context);
    getElement('community-share-autonomous-community').value = 'Galicia';
    getElement('community-share-consent').checked = true;
    assert.equal(vm.runInContext('communityShareRoute === testRoute', context), true);
    assert.equal(vm.runInContext('Cloud.loggedIn()', context), true);
    assert.equal(vm.runInContext('communityPublishing', context), false);

    await context.submitCommunityRoute();

    assert.deepEqual(order, ['count']);
    assert.deepEqual(order.concat(calls), ['count', 'persist']);
    assert.equal(route.communityRouteId, undefined);
});

test('community publication preserves elevation peaks and profile skips missing samples', () => {
    const { context } = communityContext();
    const points = [
        [40, -3, 100, 1, null, null],
        [40.001, -3, 110, 2, null, null],
        [40.002, -3, 100, 3, null, null],
        [40.003, -3, null, 4, null, null],
        [40.004, -3, 100, 5, null, null],
        [40.005, -3, 110, 6, null, null]
    ];
    const uploaded = context.communityUploadTrack({ points }).flat();

    assert.ok(uploaded.length > 4);
    assert.ok(uploaded.some(point => point[2] === 110));
    assert.ok(uploaded.some(point => point[2] === null));

    const profile = context.communityElevationProfile([uploaded]);
    assert.ok(profile);
    assert.equal(profile.segments.length, 2);
    assert.equal(profile.sampleCount, 5);
    assert.ok(profile.maxAltitude > profile.minAltitude);
    assert.ok(profile.ascentM > 0);
});

test('community track simplification reduces long tracks with missing altitude and preserves profile gaps', () => {
    const { context } = communityContext();
    const points = Array.from({ length: 5000 }, (_, index) => [
        40 + index * 0.00001,
        -3,
        null
    ]);

    const simplified = context.communityUploadTrack({ points }).flat();

    assert.equal(simplified.length, 2);
    assert.deepEqual(Array.from(simplified[0]), [40, -3, null]);
    assert.deepEqual(Array.from(simplified[1]), [40.04999, -3, null]);

    const gapTrack = Array.from({ length: 100 }, (_, index) => [
        41 + index * 0.00001,
        -4,
        index < 10 || index > 89 ? 100 + (index % 2) * 10 : null
    ]);
    const gapSimplified = context.communityUploadTrack({ points: gapTrack }).flat();
    assert.ok(gapSimplified.some(point => point[2] === null));
    assert.ok(gapSimplified.length < gapTrack.length);
});

test('community track simplification retains a peak in a long ascent and descent', () => {
    const { context } = communityContext();
    const points = Array.from({ length: 4001 }, (_, index) => [
        40 + index * 0.000001,
        -3,
        index <= 2000 ? index * 0.05 : (4000 - index) * 0.05
    ]);

    const simplified = context.communityUploadTrack({ points }).flat();

    assert.ok(simplified.length <= 3000);
    assert.ok(simplified.some(point => point[2] === 100));
});

test('community publication increases elevation tolerance to meet its point budget', () => {
    const { context } = communityContext();
    const points = Array.from({ length: 3001 }, (_, index) => [
        40 + index * 0.0000001,
        -3,
        index % 2 ? 120 : 100
    ]);

    const simplified = context.communityUploadTrack({ points }).flat();

    assert.ok(simplified.length <= 3000);
    assert.deepEqual(Array.from(simplified[0]), points[0]);
    assert.deepEqual(Array.from(simplified[simplified.length - 1]), points[points.length - 1]);
});

test('community elevation simplification accounts for uneven sample spacing', () => {
    const { context } = communityContext();
    const points = [
        [40, -3, 100],
        [40.0001, -3, 150],
        [40.01, -3, 200]
    ];

    const simplified = context.communityUploadTrack({ points }).flat();

    assert.ok(simplified.some(point => point[2] === 150));
});

test('community track segmentation preserves explicit pause separators', () => {
    const { context } = communityContext();
    const points = [
        [40, -3, 100],
        [40.001, -3, 110],
        null,
        [41, -4, 120],
        [41.001, -4, 130]
    ];

    const lines = context.communityRawSegments(points, true);
    const uploaded = context.communityUploadTrack({ points });

    assert.equal(lines.length, 2);
    assert.equal(uploaded.length, 2);
    assert.equal(uploaded[0].length, 2);
    assert.equal(uploaded[1].length, 2);
});

test('community profile does not invent altitude when the route has only coordinates', () => {
    const { context } = communityContext();

    assert.equal(context.communityElevationProfile([[
        [40, -3],
        [40.001, -3],
        [40.002, -3]
    ]]), null);
});

test('community server route uses the stored accumulated ascent in its profile summary', () => {
    const { context, getElement } = communityContext();
    const lines = [[
        [40, -3, 100],
        [40.001, -3, 120],
        [40.002, -3, 100]
    ]];

    context.renderCommunityElevationProfile(lines, { elevationGain: 3667 });

    assert.equal(getElement('community-detail-elevation-chart').hidden, false);
    assert.match(getElement('community-detail-elevation-summary').textContent, /\+3667 m/);
});

test('community server detail can recover its owner route profile without exposing it to others', () => {
    const { context } = communityContext({
        Cloud: { loggedIn: () => true, uid: 'user-1', server: '', authGeneration: 1 }
    });
    const points = Array.from({ length: 10 }, (_, index) => [
        40 + index * 0.002,
        -3,
        100 + (index % 3) * 10,
        index + 1,
        null,
        null
    ]);
    context.savedRoutes = [{
        communityRouteId: 'route-1',
        kind: 'recorded',
        points
    }];

    const recovered = context.communityElevationLines(
        { id: 'route-1', owner: 'user-1' },
        [[[40, -3], [40.01, -3]]]
    );
    assert.ok(context.communityElevationProfile(recovered));
    assert.equal(context.communityElevationLines(
        { id: 'route-1', owner: 'another-user' },
        [[[40, -3], [40.01, -3]]]
    )[0][0].length, 2);
});
