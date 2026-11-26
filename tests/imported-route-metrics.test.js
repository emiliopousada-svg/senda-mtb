'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const statisticsEngine = require('../app/statistics-engine.js');

const routeFilesSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'route-files.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'storage.js'), 'utf8');

function extract(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
    assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
    return source.slice(start, end);
}

test('imported tracks preserve cumulative ascent at retained points', () => {
    const routeContext = vm.createContext({
        Cloud: { nickname: 'Rider' },
        Date,
        Math,
        Number,
        MTBStatisticsEngine: statisticsEngine,
        dist: () => 1,
        makeElevTracker: () => statisticsEngine.createElevationTracker({ threshold: 3, smoothingWindow: 5 })
    });
    vm.runInContext(
        `${extract(routeFilesSource, 'function buildImportedRoute(', '\n// ============================================================')}; globalThis.testBuildImportedRoute = buildImportedRoute;`,
        routeContext
    );

    const timestamp = Date.UTC(2026, 0, 1);
    const sourcePoints = Array.from({ length: 40001 }, (_, index) => [
        42 + index * 0.000001,
        -8,
        100 + Math.floor(index / 10),
        timestamp + index * 1000
    ]);
    const route = routeContext.testBuildImportedRoute({ segs: [sourcePoints], description: '' }, 'Long route');
    const storageContext = vm.createContext({
        ELEV_STEP: 3,
        MTBStatisticsEngine: statisticsEngine
    });
    vm.runInContext(
        `${extract(storageSource, 'function makeElevTracker()', '\n// ============================================================')}; globalThis.testGainCumulative = gainCumulative;`,
        storageContext
    );
    const gainAtStoredPoints = storageContext.testGainCumulative(route.points);

    assert.ok(route.points.length < sourcePoints.length);
    assert.ok(route.points.length <= 20000);
    assert.equal(gainAtStoredPoints[gainAtStoredPoints.length - 1], route.elevationGain);
});

test('cumulative ascent carries gain across track breaks without adding the prior segment twice', () => {
    const storageContext = vm.createContext({
        ELEV_STEP: 3,
        MTBStatisticsEngine: statisticsEngine
    });
    vm.runInContext(
        `${extract(storageSource, 'function makeElevTracker()', '\n// ============================================================')}; globalThis.testGainCumulative = gainCumulative;`,
        storageContext
    );
    const altitudes = [100, 100, 100, 100, 100, 110, 110, 110, 110, 110];
    const points = [
        ...altitudes.map((altitude, index) => [42, -8, altitude, 1000 + index * 1000]),
        ...altitudes.map((altitude, index) => [
            42, -8, altitude, 11000 + index * 1000, null, index === 0 ? 1 : null
        ]),
        null,
        ...altitudes.map((altitude, index) => [42, -8, altitude, 21000 + index * 1000])
    ];

    const gain = storageContext.testGainCumulative(points);

    assert.equal(gain[9], 10);
    assert.equal(gain[10], 10);
    assert.equal(gain[19], 20);
    assert.equal(gain[20], 20);
    assert.equal(gain[21], 20);
    assert.equal(gain[gain.length - 1], 30);
});
