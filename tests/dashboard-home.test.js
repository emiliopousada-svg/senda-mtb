'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.js'), 'utf8');

function dashboardContext(nickname, avatarUrl = '') {
    const greeting = { textContent: '' };
    const avatar = {
        hidden: true,
        src: '',
        removeAttribute(name) { if (name === 'src') this.src = ''; }
    };
    const avatarPlaceholder = { hidden: false };
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
        getAccountAvatarUrl: () => avatarUrl,
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
            if (id === 'home-avatar') return avatar;
            if (id === 'home-avatar-placeholder') return avatarPlaceholder;
            if (id === 'dashboard-gps-status') return gps;
            if (id === 'dashboard-network-status') return network;
            return null;
        }
    });
    vm.runInContext(dashboardSource, context);
    return { context, greeting, avatar, avatarPlaceholder, gps, network };
}

test('home greeting uses the account nickname and falls back when signed out', () => {
    const { context, greeting } = dashboardContext('TrailRider');
    assert.equal(greeting.textContent, '¡Hola, TrailRider!');
    context.Cloud.nickname = '';
    context.dashboardUpdateGreeting();
    assert.equal(greeting.textContent, '¡Hola, Biker!');
});

test('home shows the cached account avatar beside the greeting or the placeholder', () => {
    const { context, avatar, avatarPlaceholder } = dashboardContext('TrailRider', 'data:image/jpeg;base64,avatar');
    assert.equal(avatar.hidden, false);
    assert.equal(avatar.src, 'data:image/jpeg;base64,avatar');
    assert.equal(avatarPlaceholder.hidden, true);

    context.getAccountAvatarUrl = () => '';
    context.dashboardUpdateGreeting();
    assert.equal(avatar.hidden, true);
    assert.equal(avatar.src, '');
    assert.equal(avatarPlaceholder.hidden, false);
});

test('home groups GPS with network status and labels the control-center shortcut beside recording', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /class="dashboard-greeting"[\s\S]*id="home-greeting"[\s\S]*id="home-avatar"/);
    const actions = html.match(/<div class="hero-actions">([\s\S]*?)<\/div>\s*<\/div>/);
    assert.ok(actions);
    assert.match(actions[1], /data-recording[\s\S]*data-page="7"[^>]*>Centro de control<\/button>[\s\S]*data-page="6"[^>]*>Cockpit<\/button>/);
    assert.doesNotMatch(html, /tools-menu-button|>☷<\/button>/);
    assert.match(actions[1], /class="hero-connectivity-status"[\s\S]*id="dashboard-network-status"[\s\S]*id="dashboard-gps-status"/);
    assert.doesNotMatch(html, /class="hero-status"/);
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

test('tools hub does not duplicate the Bluetooth sensor settings', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const toolsHub = html.match(/<section class="tools-hub"[\s\S]*?<\/section>/);
    assert.ok(toolsHub);
    assert.doesNotMatch(toolsHub[0], /data-tool="sensors"|<strong>Sensores<\/strong>/);
    assert.match(html, /id="settings-sensors"[\s\S]*id="sensor-hr-enabled"/);
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

test('dashboard loads before cloud.js without errors and keeps network listeners', () => {
    const listeners = [];
    const greeting = { textContent: '' };
    const network = {
        classList: { toggle() {} },
        setAttribute() {},
        innerHTML: ''
    };
    const context = vm.createContext({
        currentPage: 5,
        activeStatsSlide: 0,
        navigator: { onLine: true },
        window: { addEventListener(type) { listeners.push(type); } },
        document: {
            addEventListener() {},
            querySelectorAll() { return []; }
        },
        $(id) {
            if (id === 'home-greeting') return greeting;
            if (id === 'dashboard-network-status') return network;
            return null;
        }
    });
    assert.doesNotThrow(() => vm.runInContext(dashboardSource, context));
    assert.equal(greeting.textContent, '¡Hola, Biker!');
    assert.ok(listeners.includes('online'), 'falta el listener online');
    assert.ok(listeners.includes('offline'), 'falta el listener offline');
});
