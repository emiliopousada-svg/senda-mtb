'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function element() {
    return {
        children: [],
        dataset: {},
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); return child; },
        addEventListener() {},
        setAttribute() {},
        textContent: ''
    };
}

function interactiveElement() {
    const listeners = new Map();
    return {
        children: [],
        dataset: {},
        value: '',
        returnValue: '',
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        dispatch(type, event = {}) {
            for (const listener of listeners.get(type) || []) listener(event);
        },
        replaceChildren(...children) { this.children = children; },
        setCustomValidity(message) { this.validationMessage = message; },
        reportValidity() { return !this.validationMessage; },
        focus() {},
        showModal() { this.open = true; },
        close(value) {
            this.returnValue = value;
            this.open = false;
            this.dispatch('close');
        }
    };
}

test('completed route cards expose activity editing, description editing, and trash actions', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8');
    const start = source.indexOf('function createRouteCard(');
    const end = source.indexOf("\n$('btn-routes-add')", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    const context = vm.createContext({
        document: { createElement: element },
        routesTab: 'done',
        routesShowAll: false,
        ACTIVITY_TYPES: { mtb: { icon: '🚵', label: 'MTB' } },
        activityTypeForRoute: () => 'mtb',
        createRouteCardMap: () => null,
        observeRouteCardMap() {},
        routeCoverPhoto: () => null,
        routePerformedAt: () => null,
        fmtDate: () => '',
        routeDistanceKm: () => 1,
        routeHasElevationData: () => false,
        routeMovingTime: () => 0,
        routeMovingTimeLabel: (_route, label) => label,
        routeAverageSpeed: () => NaN,
        routeCanPublishCommunity: () => false
    });
    vm.runInContext(source.slice(start, end), context);

    const card = context.createRouteCard({ id: 8, name: 'Forest loop', kind: 'recorded' });
    const actions = card.children[card.children.length - 1];

    assert.deepEqual(actions.children.map(button => button.dataset.act).slice(0, 3), [
        'edit-route', 'edit-details', 'del'
    ]);
    assert.equal(actions.children[0].textContent, '✏️ Cambiar');
});

test('route editor saves the new name and activity type together', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8');
    const start = source.indexOf('const routeMetadataSaveQueues = new WeakMap();');
    const end = source.indexOf('\nasync function shareSavedRoute(', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    const elements = new Map([
        ['route-edit-dialog', interactiveElement()],
        ['route-edit-form', interactiveElement()],
        ['route-edit-name', interactiveElement()],
        ['route-edit-activity-type', interactiveElement()],
        ['route-edit-close', interactiveElement()],
        ['route-edit-cancel', interactiveElement()]
    ]);
    const saved = [];
    let statsRefreshes = 0;
    let invalidations = 0;
    const context = vm.createContext({
        $: id => elements.get(id),
        document: { createElement: element },
        ACTIVITY_TYPES: {
            mtb: { icon: '🚵', label: 'MTB' },
            road: { icon: '🚴', label: 'Carretera' }
        },
        routeNameWithoutActivity: route => route.name.replace(/^🚵 MTB · |^🚴 Carretera · /, ''),
        activityTypeForRoute: route => route.activityType,
        routeActivityPrefix: type => type === 'road' ? '🚴 Carretera · ' : '🚵 MTB · ',
        DB: { async put(route) { saved.push({ ...route }); } },
        statsInvalidateRouteAnalysis() { invalidations++; },
        renderSavedRoutes() {},
        refreshStats() { statsRefreshes++; },
        syncRoutes() {},
        console: { warn() {} },
        toast() {}
    });
    vm.runInContext(`${source.slice(start, end)}\nglobalThis.testEditSavedRoute = editSavedRoute;`, context);

    const route = {
        id: 8,
        name: '🚵 MTB · Bosque',
        activityType: 'mtb',
        remoteId: 'remote-8',
        dirty: false
    };
    const edit = context.testEditSavedRoute(route);
    const nameInput = elements.get('route-edit-name');
    const activitySelect = elements.get('route-edit-activity-type');
    assert.deepEqual(activitySelect.children.map(option => option.value), ['mtb', 'road']);
    nameInput.value = '   ';
    elements.get('route-edit-form').dispatch('submit', { preventDefault() {} });
    assert.match(nameInput.validationMessage, /obligatorio/);
    nameInput.value = 'Costa';
    nameInput.dispatch('input');
    assert.equal(nameInput.validationMessage, '');
    activitySelect.value = 'road';
    elements.get('route-edit-form').dispatch('submit', { preventDefault() {} });
    await edit;

    assert.equal(route.name, '🚴 Carretera · Costa');
    assert.equal(route.activityType, 'road');
    assert.equal(route.dirty, true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, route.name);
    assert.equal(saved[0].activityType, route.activityType);
    assert.equal(invalidations, 1);
    assert.equal(statsRefreshes, 1);
});

test('route editor leaves existing metadata unchanged when saving fails', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8');
    const start = source.indexOf('const routeMetadataSaveQueues = new WeakMap();');
    const end = source.indexOf('\nasync function shareSavedRoute(', start);
    const elements = new Map([
        ['route-edit-dialog', interactiveElement()],
        ['route-edit-form', interactiveElement()],
        ['route-edit-name', interactiveElement()],
        ['route-edit-activity-type', interactiveElement()],
        ['route-edit-close', interactiveElement()],
        ['route-edit-cancel', interactiveElement()]
    ]);
    const context = vm.createContext({
        $: id => elements.get(id),
        document: { createElement: element },
        ACTIVITY_TYPES: { mtb: { icon: '🚵', label: 'MTB' }, road: { icon: '🚴', label: 'Carretera' } },
        routeNameWithoutActivity: route => route.name.replace(/^🚵 MTB · |^🚴 Carretera · /, ''),
        activityTypeForRoute: route => route.activityType,
        routeActivityPrefix: type => type === 'road' ? '🚴 Carretera · ' : '🚵 MTB · ',
        DB: { async put() { throw new Error('storage error'); } },
        statsInvalidateRouteAnalysis() { throw new Error('must not invalidate before persistence succeeds'); },
        renderSavedRoutes() {},
        syncRoutes() {},
        console: { warn() {} },
        toast() {}
    });
    vm.runInContext(`${source.slice(start, end)}\nglobalThis.testEditSavedRoute = editSavedRoute;`, context);

    const route = { id: 9, name: '🚵 MTB · Bosque', activityType: 'mtb', dirty: false };
    const edit = context.testEditSavedRoute(route);
    elements.get('route-edit-name').value = 'Costa';
    elements.get('route-edit-activity-type').value = 'road';
    elements.get('route-edit-form').dispatch('submit', { preventDefault() {} });
    await edit;

    assert.equal(route.name, '🚵 MTB · Bosque');
    assert.equal(route.activityType, 'mtb');
    assert.equal(route.dirty, false);
});

test('a failed earlier metadata save cannot roll back a later successful edit', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8');
    const start = source.indexOf('const routeMetadataSaveQueues = new WeakMap();');
    const end = source.indexOf('\nasync function shareSavedRoute(', start);
    const pendingPuts = [];
    const context = vm.createContext({
        DB: {
            put(route) {
                return new Promise((resolve, reject) => {
                    pendingPuts.push({ snapshot: { ...route }, resolve, reject });
                });
            }
        },
        console: { warn() {} },
        toast() {},
        statsInvalidateRouteAnalysis() {},
        renderSavedRoutes() {},
        refreshStats() {},
        syncRoutes() {}
    });
    vm.runInContext(
        `${source.slice(start, end)}\nglobalThis.testSaveRouteMetadata = routeSaveEditedMetadata;`,
        context
    );

    const route = {
        id: 10,
        name: 'Original',
        activityType: 'mtb',
        remoteId: 'remote-10',
        dirty: false
    };
    const earlierSave = context.testSaveRouteMetadata(route, {
        name: 'Earlier',
        activityType: 'road'
    });
    const laterSave = context.testSaveRouteMetadata(route, {
        name: 'Later',
        activityType: 'hiking'
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pendingPuts.length, 1);
    assert.equal(pendingPuts[0].snapshot.name, 'Earlier');
    pendingPuts[0].reject(new Error('stale save failed'));
    assert.equal(await earlierSave, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pendingPuts.length, 2);
    assert.equal(pendingPuts[1].snapshot.name, 'Later');
    pendingPuts[1].resolve();
    assert.equal(await laterSave, true);

    assert.equal(route.name, 'Later');
    assert.equal(route.activityType, 'hiking');
    assert.equal(route.dirty, true);
});

test('overlapping failed metadata saves restore the last confirmed state', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8');
    const start = source.indexOf('const routeMetadataSaveQueues = new WeakMap();');
    const end = source.indexOf('\nasync function shareSavedRoute(', start);
    const pendingPuts = [];
    const context = vm.createContext({
        DB: {
            put(route) {
                return new Promise((resolve, reject) => {
                    pendingPuts.push({ snapshot: { ...route }, resolve, reject });
                });
            }
        },
        console: { warn() {} },
        toast() {},
        statsInvalidateRouteAnalysis() {},
        renderSavedRoutes() {},
        refreshStats() {},
        syncRoutes() {}
    });
    vm.runInContext(
        `${source.slice(start, end)}\nglobalThis.testSaveRouteMetadata = routeSaveEditedMetadata;`,
        context
    );

    const route = {
        id: 11,
        name: 'Original',
        activityType: 'mtb',
        remoteId: 'remote-11',
        dirty: false
    };
    const earlierSave = context.testSaveRouteMetadata(route, {
        name: 'Earlier',
        activityType: 'road'
    });
    const laterSave = context.testSaveRouteMetadata(route, {
        name: 'Later',
        activityType: 'hiking'
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pendingPuts.length, 1);
    pendingPuts[0].reject(new Error('first save failed'));
    assert.equal(await earlierSave, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pendingPuts.length, 2);
    pendingPuts[1].reject(new Error('second save failed'));
    assert.equal(await laterSave, false);

    assert.equal(route.name, 'Original');
    assert.equal(route.activityType, 'mtb');
    assert.equal(route.dirty, false);
});

test('saved route details retain altitude samples for the elevation profile', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8');
    const start = source.indexOf('async function openSavedRouteDetail(route, options = {}) {');
    const end = source.indexOf('\nroutesFillActivityFilter(', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    let detail;
    const context = vm.createContext({
        routesTab: 'done',
        DB: { async loadRoutePhotos() {} },
        communityRawSegments(points, includeElevation) {
            return includeElevation ? [points] : [points.map(point => point.slice(0, 2))];
        },
        activityTypeForRoute: () => 'mtb',
        ACTIVITY_TYPES: { mtb: { label: 'MTB' } },
        routeCreatorName: () => 'Rider',
        routeDistanceKm: () => 1,
        routePerformedAt: () => null,
        routeHasElevationData: () => true,
        routeMovingTimeLabel: (_route, label) => label,
        routeMovingTime: () => 0,
        routeAverageSpeed: () => NaN,
        fmtDur: () => '',
        fmtDate: () => '',
        openCommunityDetail(...args) { detail = args; }
    });
    vm.runInContext(source.slice(start, end), context);

    await context.openSavedRouteDetail({
        id: 1,
        name: 'Ridge',
        kind: 'recorded',
        points: [[40, -3, 125, 1000]],
        elevationGain: 125
    });

    assert.equal(detail[1][0][0][2], 125);
});
