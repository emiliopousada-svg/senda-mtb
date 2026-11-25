'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const statisticsEngine = require('../app/statistics-engine.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'route-following.js'), 'utf8');

function routeContext({ maxMathArguments = Infinity } = {}) {
    const announcements = [];
    const messages = [];
    const navigationWakes = [];
    const elements = new Map();
    const math = Object.create(Math);
    math.min = (...values) => {
        if (values.length > maxMathArguments) throw new RangeError('too many arguments');
        return Math.min(...values);
    };
    math.max = (...values) => {
        if (values.length > maxMathArguments) throw new RangeError('too many arguments');
        return Math.max(...values);
    };
    const getElement = id => {
        if (!elements.has(id)) {
            const element = {
                textContent: '',
                attributes: new Map(),
                classes: new Set(),
                style: {},
                addEventListener() {},
                setAttribute(name, value) { this.attributes.set(name, String(value)); },
                classList: { add(name) { element.classes.add(name); } }
            };
            elements.set(id, element);
        }
        return elements.get(id);
    };
    const context = vm.createContext({
        Math: math,
        Number,
        Array,
        MTBStatisticsEngine: statisticsEngine,
        routeProfileCoords: [],
        routeProfilePointCount: 0,
        OFFROUTE_M: 60,
        BACKONROUTE_M: 30,
        offRouteState: false,
        offRouteAudioContext: null,
        navigator: {},
        dist(a, b) {
            const radians = Math.PI / 180;
            const dLat = (b[0] - a[0]) * radians;
            const dLon = (b[1] - a[1]) * radians;
            const sinLat = Math.sin(dLat / 2);
            const sinLon = Math.sin(dLon / 2);
            return 6371000 * 2 * Math.asin(Math.sqrt(
                sinLat * sinLat + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * sinLon * sinLon
            ));
        },
        bearingBetween(from, to) {
            const radians = Math.PI / 180;
            const lat1 = from[0] * radians, lat2 = to[0] * radians;
            const dLon = (to[1] - from[1]) * radians;
            const y = Math.sin(dLon) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
            return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        },
        localStorage: { getItem: () => null },
        window: { speechSynthesis: { cancel() {}, speak: utterance => announcements.push(utterance.text) } },
        SpeechSynthesisUtterance: class {
            constructor(text) { this.text = text; }
        },
        screenWakeForNavigation: () => navigationWakes.push(true),
        toast: message => messages.push(message),
        $: getElement
    });
    vm.runInContext(source, context);
    return {
        context,
        announcements,
        messages,
        navigationWakes,
        elements,
        api: vm.runInContext('({ buildRouteCumulativeDistances, buildRouteManeuvers, findFollowedRouteMatch, updateMapRouteProfilePosition, checkUpcomingRouteTurn, checkOffRoute })', context)
    };
}

function meterPoint(north, east) {
    const latitude = 42;
    return [latitude + north / 110540, -8 + east / (111320 * Math.cos(latitude * Math.PI / 180))];
}

function routePoints(direction = 'right') {
    const points = [];
    for (let north = 0; north <= 100; north += 10) points.push(meterPoint(north, 0));
    const sign = direction === 'right' ? 1 : -1;
    for (let east = 10; east <= 120; east += 10) points.push(meterPoint(100, east * sign));
    return points;
}

test('route maneuver analysis finds left and right turns but ignores straight tracks', () => {
    const { api } = routeContext();
    for (const direction of ['right', 'left']) {
        const points = routePoints(direction);
        const cumulative = api.buildRouteCumulativeDistances(points);
        const turns = api.buildRouteManeuvers(points, cumulative);
        assert.equal(turns.length, 1);
        assert.equal(turns[0].direction, direction === 'right' ? 'derecha' : 'izquierda');
        assert.ok(Math.abs(turns[0].distanceMeters - 100) < 15);
    }

    const straight = Array.from({ length: 21 }, (_, index) => meterPoint(index * 10, 0));
    assert.equal(api.buildRouteManeuvers(straight, api.buildRouteCumulativeDistances(straight)).length, 0);
});

test('route profile renders 100,000 elevation points without expanding math arguments', () => {
    const { context, elements } = routeContext({ maxMathArguments: 1000 });
    const points = Array.from({ length: 100000 }, (_, index) => [42, -8, 100 + index % 20]);
    context.routeProfileCoords = [];
    context.routeProfilePointCount = 0;

    context.renderMapRouteProfile({ name: 'Long route', points, elevationGain: 0 });

    assert.equal(elements.get('map-route-alt').textContent, '100–117 m · +0 m');
});

test('route profile smooths altitude spikes using the statistics elevation tracker', () => {
    const { context, elements } = routeContext();
    const points = [100, 100, 1000, 100, 100].map(altitude => [42, -8, altitude]);

    context.renderMapRouteProfile({ name: 'Elevation spike', points, elevationGain: 0 });

    assert.equal(elements.get('map-route-alt').textContent, '100–100 m · +0 m');
});

test('voice guidance announces a turn once when it is within 50 metres and ignores off-route fixes', () => {
    const { api, context, announcements, navigationWakes } = routeContext();
    const points = routePoints();
    const cumulativeMeters = api.buildRouteCumulativeDistances(points);
    const maneuvers = api.buildRouteManeuvers(points, cumulativeMeters);
    context.followedRoute = {
        pts: points, cumulativeMeters, maneuvers, nextManeuverIndex: 0, nextManeuverWakeIndex: 0
    };

    function matchAt(progress, distance = 0) {
        const index = cumulativeMeters.findIndex(value => value > progress) - 1;
        const segmentIndex = Math.max(0, index);
        const length = cumulativeMeters[segmentIndex + 1] - cumulativeMeters[segmentIndex];
        return { index: segmentIndex, fraction: (progress - cumulativeMeters[segmentIndex]) / length, distance };
    }

    api.checkUpcomingRouteTurn(matchAt(maneuvers[0].distanceMeters - 60));
    assert.equal(announcements.length, 0);

    api.checkUpcomingRouteTurn(matchAt(maneuvers[0].distanceMeters - 50));
    assert.equal(announcements.length, 1);
    assert.match(announcements[0], /^Gira a la derecha en 50 metros\.$/);
    assert.equal(navigationWakes.length, 0);

    api.checkUpcomingRouteTurn(matchAt(maneuvers[0].distanceMeters - 40));
    assert.equal(announcements.length, 1);
    assert.equal(navigationWakes.length, 1);

    api.checkUpcomingRouteTurn(matchAt(maneuvers[0].distanceMeters - 35));
    assert.equal(announcements.length, 1);
    assert.equal(navigationWakes.length, 1);

    context.followedRoute.nextManeuverIndex = 0;
    context.followedRoute.nextManeuverWakeIndex = 0;
    api.checkUpcomingRouteTurn(matchAt(maneuvers[0].distanceMeters - 30, 61));
    assert.equal(announcements.length, 1);
    assert.equal(navigationWakes.length, 1);
});

test('route deviation wakes the dimmed OLED cockpit once and return to route keeps the existing voice notice', () => {
    const { api, context, announcements, navigationWakes } = routeContext();
    context.followedRoute = {};

    api.checkOffRoute(42, -8, { distance: 61 });
    api.checkOffRoute(42, -8, { distance: 80 });
    assert.equal(navigationWakes.length, 1);
    assert.match(announcements[0], /fuera de la ruta/);

    api.checkOffRoute(42, -8, { distance: 20 });
    assert.equal(navigationWakes.length, 1);
    assert.equal(announcements[1], 'Has vuelto a la ruta.');
});

test('route matching rate-limits full scans while the rider remains far from a large route', () => {
    const { context, api } = routeContext();
    context.followedRoute = {
        pts: Array.from({ length: 1000 }, (_, index) => [42, -8 + index * 0.00001]),
        progressIndex: 0,
        lastGlobalScanAt: Date.now()
    };
    let segmentChecks = 0;
    context.pointSegDistM = () => {
        segmentChecks++;
        return 300;
    };
    context.pointSegFraction = () => 0;

    api.findFollowedRouteMatch(42, -8);
    assert.equal(segmentChecks, 181);

    const localScanChecks = segmentChecks;
    context.followedRoute.lastGlobalScanAt = Date.now() - 6000;
    api.findFollowedRouteMatch(42, -8);
    assert.equal(segmentChecks - localScanChecks, 181 + 999);
});

test('route profile cursor finds its interpolation bracket logarithmically', () => {
    const { context, elements, api } = routeContext();
    const coords = Array.from({ length: 32768 }, (_, index) => ({ i: index, x: index, y: index }));
    let reads = 0;
    context.routeProfileCoords = new Proxy(coords, {
        get(target, property, receiver) {
            if (/^(0|[1-9]\d*)$/.test(String(property))) reads++;
            return Reflect.get(target, property, receiver);
        }
    });
    context.routeProfilePointCount = coords.length;
    context.followedRoute = { gainCum: null };
    context.isRecording = false;

    api.updateMapRouteProfilePosition({ index: 16384 });

    assert.equal(elements.get('map-route-cursor').attributes.get('cy'), '16384.0');
    assert.ok(reads < 100, `expected logarithmic access count, got ${reads}`);
});
