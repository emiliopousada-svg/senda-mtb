'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function reliefContext() {
    const context = vm.createContext({ Math, Number, Array, window: {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'route-relief.js'), 'utf8'), context);
    return context;
}

function climbRoute(count = 60, gain = 240) {
    return Array.from({ length: count }, (_, index) => [
        42.39 + index * 0.0004,
        -8.5 + index * 0.0003,
        300 + (gain * index) / (count - 1),
        1700000000000 + index * 5000,
        null,
        null
    ]);
}

test('relief model needs enough altitude readings', () => {
    const { routeReliefModel } = reliefContext();
    assert.equal(routeReliefModel([]), null);
    assert.equal(routeReliefModel(climbRoute().map(point => [point[0], point[1], null])), null);
    const flat = climbRoute().map(point => [point[0], point[1], 120]);
    assert.equal(routeReliefModel(flat), null, 'sin desnivel no se dibuja relieve');
});

test('relief model normalises the route and reports real altitudes', () => {
    const { routeReliefModel } = reliefContext();
    const model = routeReliefModel(climbRoute());
    assert.ok(model);
    assert.equal(model.minAlt, 300);
    assert.equal(model.maxAlt, 540);
    assert.ok(model.exaggeration >= 1 && model.exaggeration <= 12);
    model.nodes.forEach(node => {
        assert.ok(Math.abs(node.x) <= 0.5 + 1e-9 && Math.abs(node.y) <= 0.5 + 1e-9);
        assert.ok(node.t >= 0 && node.t <= 1);
    });
    assert.equal(model.nodes[0].t, 0);
    assert.equal(model.nodes[model.nodes.length - 1].t, 1);
});

test('relief model fills altitude gaps, keeps breaks and limits points', () => {
    const { routeReliefModel } = reliefContext();
    const points = climbRoute(2000);
    points[10][2] = null;
    points[1000][5] = 1;
    const model = routeReliefModel(points);
    assert.ok(model.nodes.length <= 440);
    assert.ok(model.nodes.some(node => node.brk), 'conserva el corte de segmento');
    assert.ok(model.nodes.every(node => Number.isFinite(node.z)));
});

test('relief projection keeps height above the ground', () => {
    const { routeReliefProject } = reliefContext();
    const view = { yaw: -32, tilt: 34 };
    const ground = routeReliefProject({ x: 0.1, y: 0.2, z: 0 }, view);
    const high = routeReliefProject({ x: 0.1, y: 0.2, z: 0.3 }, view);
    assert.ok(high.y < ground.y, 'los puntos altos se dibujan más arriba');
    assert.equal(high.x, ground.x);
});
