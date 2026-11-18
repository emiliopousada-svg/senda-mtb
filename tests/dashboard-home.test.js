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
    const accountIndicator = {
        classes: {},
        classList: { toggle(name, active) { accountIndicator.classes[name] = active; } },
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        title: ''
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
            if (id === 'acc-server-status') return accountIndicator;
            return null;
        }
    });
    vm.runInContext(dashboardSource, context);
    return { context, greeting, avatar, avatarPlaceholder, gps, network, accountIndicator };
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

test('home omits the recording CTA and adventure tagline but keeps its shortcuts and status', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /class="dashboard-greeting"[\s\S]*id="home-greeting"[\s\S]*id="home-avatar"/);
    const actions = html.match(/<div class="hero-actions">([\s\S]*?)<\/div>\s*<\/div>/);
    assert.ok(actions);
    assert.match(actions[1], /data-page="7"[^>]*>Centro de control<\/button>[\s\S]*data-page="6"[^>]*>Cockpit<\/button>/);
    const home = html.slice(html.indexOf('<div class="page dashboard-page" id="page-home">'),
        html.indexOf('<div class="page cockpit-page" id="page-cockpit">'));
    assert.doesNotMatch(home, /data-recording|Grabar salida|Tu próxima aventura empieza aquí/);
    assert.match(html, /class="sidebar-link sidebar-record"[^>]*data-recording/);
    assert.doesNotMatch(html, /tools-menu-button|>☷<\/button>/);
    assert.doesNotMatch(actions[1], /hero-connectivity-status/);
    assert.match(html, /class="hero-topline"[\s\S]*class="eyebrow"[\s\S]*class="hero-connectivity-status"[\s\S]*id="dashboard-network-status"[\s\S]*id="dashboard-gps-status"[\s\S]*class="dashboard-greeting"/);
    assert.match(html, /id="home-greeting"[\s\S]*id="home-last-ride"/);
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
    assert.match(gps.innerHTML.replace(/<[^>]+>/g, ''), /GPS · Excelente/);
    assert.match(gps.innerHTML, /class="gps-status-detail"/);
    assert.equal((gps.innerHTML.match(/class="active"/g) || []).length, 4);

    context.lastAccuracy = 25;
    context.dashboardUpdateGpsStatus();
    assert.equal(gps.attributes['data-gps-quality'], '1');
    assert.equal((gps.innerHTML.match(/class="active"/g) || []).length, 1);
});

test('control center contains recording, sensor, map and miscellaneous settings panels', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const toolsSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'tools.js'), 'utf8');
    const settingsStart = html.indexOf('<div class="page content-panel" id="page-settings">');
    const settingsEnd = html.indexOf('<!-- INICIO / DASHBOARD senda-mtb -->', settingsStart);
    const toolsStart = html.indexOf('<div class="page tools-page" id="page-tools">');
    const toolsEnd = html.indexOf('<!-- NAVEGACIÓN DE PESTAÑAS INFERIOR -->', toolsStart);
    const settingsPage = html.slice(settingsStart, settingsEnd);
    const toolsPage = html.slice(toolsStart, toolsEnd);

    assert.match(toolsPage, /data-tool="recording"[\s\S]*Panel de grabación/);
    assert.match(toolsPage, /data-tool="sensors"[\s\S]*Sensores Bluetooth/);
    assert.match(toolsPage, /data-tool="offline-maps"[\s\S]*Mapas sin conexión/);
    assert.match(toolsPage, /data-tool="map-style"[\s\S]*Cartografía del mapa/);
    assert.match(toolsPage, /data-tool="social"[\s\S]*Social/);
    assert.match(toolsPage, /id="social-workspace"[\s\S]*Conecta Strava[\s\S]*Subir a Strava/);
    assert.match(toolsPage, /data-tool="misc-settings"[\s\S]*Ajustes varios/);
    for (const id of ['recording-metric-config', 'settings-sensors', 'offline-panel', 'map-style-select', 'setting-route-sound', 'app-version']) {
        assert.ok(toolsPage.includes(`id="${id}"`), `${id} must be in the control center`);
        assert.ok(!settingsPage.includes(`id="${id}"`), `${id} must not remain in Profile`);
    }
    assert.match(toolsPage, /tools-app-version[\s\S]*Aplicación[\s\S]*Versión instalada/);
    assert.match(toolsSource, /case 'offline-maps'[\s\S]*openOfflineMaps\(\)/);
    assert.match(toolsSource, /case 'social':[\s\S]*toolsOpenWorkspace\('social-workspace'\)/);
});

test('home network status glows online and switches to offline state', () => {
    const { context, network, accountIndicator } = dashboardContext('TrailRider');
    assert.equal(network.classes.connected, true);
    assert.match(network.innerHTML, /En línea/);
    assert.equal(accountIndicator.classes.connected, true);
    assert.equal(accountIndicator.attributes['aria-label'], 'Estado del servidor: conectado');

    context.navigator.onLine = false;
    context.dashboardUpdateNetworkStatus();
    assert.equal(network.classes.connected, false);
    assert.equal(network.classes.offline, true);
    assert.match(network.innerHTML, /Sin conexión/);
    assert.equal(accountIndicator.classes.connected, false);
    assert.equal(accountIndicator.classes.offline, true);
    assert.equal(accountIndicator.attributes['aria-label'], 'Estado del servidor: sin conexión');
});

test('profile hides the synchronization server URL and shows the illuminated server status', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.doesNotMatch(html, /id="acc-server"|Servidor de sincronización:/);
    assert.match(html, /id="acc-server-status" class="account-server-status"[^>]*role="status"[^>]*aria-label="Estado del servidor"[\s\S]*<span>Estado del servidor<\/span>/);
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
        localStorage: { getItem: () => null },
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

test('home hero summarizes how long ago the latest ride was', () => {
    const { context } = dashboardContext('TrailRider');
    const daysAgo = days => {
        const date = new Date();
        date.setDate(date.getDate() - days);
        return date.toISOString();
    };
    assert.equal(context.dashboardLastRideAgo(daysAgo(0)), 'Última salida hoy');
    assert.equal(context.dashboardLastRideAgo(daysAgo(1)), 'Última salida ayer');
    assert.equal(context.dashboardLastRideAgo(daysAgo(3)), 'Última salida hace 3 días');
    assert.match(context.dashboardLastRideAgo(daysAgo(45)), /^Última salida el /);
    assert.equal(context.dashboardLastRideAgo(null), 'Última salida');
});
