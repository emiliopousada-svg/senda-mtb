'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'routes.js'), 'utf8');
const start = source.indexOf('function routeMovingTimeLabel(');
const end = source.indexOf('\nfunction routeDistanceKm(', start);
assert.notEqual(start, -1, 'Missing routeMovingTimeLabel');
assert.notEqual(end, -1, 'Missing routeDistanceKm');

function routeTimeLabelContext(analysis) {
    return vm.createContext({
        statsAnalyzeRoute: () => analysis,
        routeMovingTime: () => analysis.movingTimeSec
    });
}

test('labels estimated moving time without changing recorded-time labels', () => {
    const estimated = routeTimeLabelContext({ movingTimeSec: 3600, movingTimeEstimated: true });
    vm.runInContext(`${source.slice(start, end)}; globalThis.testLabel = routeMovingTimeLabel;`, estimated);
    assert.equal(estimated.testLabel({}, 'Tiempo'), 'Tiempo (estimado)');
    assert.equal(estimated.testLabel({}, 'Tiempo en movimiento'), 'Tiempo en movimiento (estimado)');

    const recorded = routeTimeLabelContext({ movingTimeSec: 3600, movingTimeEstimated: false });
    vm.runInContext(`${source.slice(start, end)}; globalThis.testLabel = routeMovingTimeLabel;`, recorded);
    assert.equal(recorded.testLabel({}, 'Tiempo'), 'Tiempo');
});

test('does not label unavailable estimated time as a completed estimate', () => {
    const context = routeTimeLabelContext({ movingTimeSec: 0, movingTimeEstimated: true });
    vm.runInContext(`${source.slice(start, end)}; globalThis.testLabel = routeMovingTimeLabel;`, context);
    assert.equal(context.testLabel({}, 'Tiempo'), 'Tiempo');
});
