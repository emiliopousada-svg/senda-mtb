'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.js'), 'utf8');

function dashboardContext(nickname) {
    const greeting = { textContent: '' };
    const gps = {
        attributes: {},
        classList: { toggle() {} },
        setAttribute(name, value) { this.attributes[name] = value; },
        innerHTML: ''
    };
    const network = {
        classes: {},
        classList: { toggle(name, active) { network.classes[name] = active; } },
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        innerHTML: ''
    };
    const context = vm.createContext({
        Cloud: { nickname },
        currentPage: 5,
        activeStatsSlide: 0,
        firstFix: false,
        lastAccuracy: null,
        MAX_ACC_M: 30,
        navigator: { onLine: true },
        window: { addEventListener() {} },
        document: {
            addEventListener() {},
            querySelectorAll() { return []; }
        },
        $(id) {
            if (id === 'home-greeting') return greeting;
            if (id === 'dashboard-gps-status') return gps;
            if (id === 'dashboard-network-status') return network;
            return null;
        }
    });
    vm.runInContext(dashboardSource, context);
    return { context, greeting, gps, network };
}

test('home greeting uses the account nickname and falls back when signed out', () => {
    const { context, greeting } = dashboardContext('TrailRider');
    assert.equal(greeting.textContent, '¡Hola, TrailRider!');
    context.Cloud.nickname = '';
    context.dashboardUpdateGreeting();
    assert.equal(greeting.textContent, '¡Hola, Biker!');
});

test('home action area has GPS and network status without organize or fullscreen controls', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const actions = html.match(/<div class="hero-actions">([\s\S]*?)<\/div>/);
    assert.ok(actions);
    assert.match(actions[1], /id="dashboard-gps-status"/);
    assert.match(actions[1], /id="dashboard-network-status"/);
    assert.doesNotMatch(html, /dashboard-arrange-toggle|screen-fullscreen-toggle|fullscreen-exit/);
    assert.doesNotMatch(dashboardSource, /dashboardInitCardArrangement|dashboard-arrange-toggle/);
});

test('home GPS status shows signal quality as up to four bars', () => {
    const { context, gps } = dashboardContext('TrailRider');
    context.firstFix = true;
    context.lastAccuracy = 4;
    context.dashboardUpdateGpsStatus();
    assert.equal(gps.attributes['data-gps-quality'], '4');
    assert.match(gps.innerHTML, /GPS · Excelente/);
    assert.equal((gps.innerHTML.match(/class="active"/g) || []).length, 4);

    context.lastAccuracy = 25;
    context.dashboardUpdateGpsStatus();
    assert.equal(gps.attributes['data-gps-quality'], '1');
    assert.equal((gps.innerHTML.match(/class="active"/g) || []).length, 1);
});

test('home network status glows online and switches to offline state', () => {
    const { context, network } = dashboardContext('TrailRider');
    assert.equal(network.classes.connected, true);
    assert.match(network.innerHTML, /En línea/);

    context.navigator.onLine = false;
    context.dashboardUpdateNetworkStatus();
    assert.equal(network.classes.connected, false);
    assert.equal(network.classes.offline, true);
    assert.match(network.innerHTML, /Sin conexión/);
});
