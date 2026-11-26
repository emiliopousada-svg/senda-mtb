'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.js'), 'utf8');

function dashboardContext(nickname, avatarUrl = '', homeRoutePreview = null) {
    const greeting = { textContent: '' };
    const avatar = {
        hidden: true,
        listeners: {},
        addEventListener(name, listener) { this.listeners[name] = listener; }
    };
    const avatarImage = {
        src: '',
        removeAttribute(name) { if (name === 'src') this.src = ''; }
    };
    const avatarPlaceholder = { hidden: false };
    const avatarPreview = {
        src: '',
        listeners: {},
        addEventListener(name, listener) { this.listeners[name] = listener; },
        removeAttribute(name) { if (name === 'src') this.src = ''; }
    };
    const avatarDialog = {
        open: false,
        listeners: {},
        addEventListener(name, listener) { this.listeners[name] = listener; },
        showModal() { this.open = true; },
        close() {
            this.open = false;
            this.listeners.close();
        }
    };
    const avatarCloseButton = {
        listeners: {},
        addEventListener(name, listener) { this.listeners[name] = listener; }
    };
    const gps = {
        attributes: {},
        classList: { toggle() {} },
        setAttribute(name, value) { this.attributes[name] = value; },
        innerHTML: ''
    };
    const mapGps = {
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; }
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
        label: { textContent: 'Servidor' },
        querySelector(selector) { return selector === 'span' ? this.label : null; },
        title: ''
    };
    const context = vm.createContext({
        Cloud: { nickname, server: 'https://server.example' },
        getAccountAvatarUrl: () => avatarUrl,
        currentPage: 5,
        activeStatsSlide: 0,
        firstFix: false,
        lastAccuracy: null,
        MAX_ACC_M: 30,
        navigator: { onLine: true },
        AbortController,
        setTimeout,
        clearTimeout,
        window: { addEventListener() {} },
        document: {
            addEventListener() {},
            querySelectorAll() { return []; }
        },
        $(id) {
            if (id === 'home-greeting') return greeting;
            if (id === 'home-avatar') return avatar;
            if (id === 'home-avatar-image') return avatarImage;
            if (id === 'home-avatar-placeholder') return avatarPlaceholder;
            if (id === 'home-avatar-dialog') return avatarDialog;
            if (id === 'home-avatar-dialog-image') return avatarPreview;
            if (id === 'home-avatar-dialog-close') return avatarCloseButton;
            if (id === 'dashboard-gps-status') return gps;
            if (id === 'map-live-gps') return mapGps;
            if (id === 'dashboard-network-status') return network;
            if (id === 'acc-server-status') return accountIndicator;
            if (id === 'home-map') return homeRoutePreview;
            return null;
        }
    });
    vm.runInContext(dashboardSource, context);
    return { context, greeting, avatar, avatarImage, avatarPlaceholder, avatarPreview, avatarDialog, avatarCloseButton, gps, mapGps, network, accountIndicator };
}

test('home greeting uses the account nickname and falls back when signed out', () => {
    const { context, greeting } = dashboardContext('TrailRider');
    assert.equal(greeting.textContent, '¡Hola, TrailRider!');
    context.Cloud.nickname = '';
    context.dashboardUpdateGreeting();
    assert.equal(greeting.textContent, '¡Hola, Biker!');
});

test('home shows the cached account avatar beside the greeting or the placeholder', () => {
    const { context, avatar, avatarPlaceholder, avatarPreview } = dashboardContext('TrailRider', 'data:image/jpeg;base64,avatar');
    assert.equal(avatar.hidden, false);
    assert.equal(avatarPlaceholder.hidden, true);
    avatar.listeners.click();
    assert.equal(context.$('home-avatar-dialog').open, true);
    assert.equal(context.$('home-avatar-dialog-image').src, 'data:image/jpeg;base64,avatar');
    avatarPreview.listeners.click();
    assert.equal(context.$('home-avatar-dialog').open, false);
    assert.equal(context.$('home-avatar-dialog-image').src, '');

    avatar.listeners.click();
    context.$('home-avatar-dialog-close').listeners.click();
    assert.equal(context.$('home-avatar-dialog').open, false);
    assert.equal(context.$('home-avatar-dialog-image').src, '');

    context.getAccountAvatarUrl = () => '';
    context.dashboardUpdateGreeting();
    assert.equal(avatar.hidden, true);
    assert.equal(context.$('home-avatar-image').src, '');
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
    const latestRoutePanel = html.match(/<article class="dashboard-panel dashboard-map-panel"[\s\S]*?<\/article>/);
    assert.ok(latestRoutePanel);
    assert.match(latestRoutePanel[0], /id="home-latest-route-metrics"[\s\S]*id="home-latest-route-speed"[\s\S]*id="home-latest-route-ascent"[\s\S]*id="home-latest-route-heart-rate"[\s\S]*id="home-latest-route-time"[\s\S]*id="home-map"/);
    assert.match(latestRoutePanel[0], /id="home-map" role="region" aria-label="Relieve 3D de tu última ruta"/);
    assert.doesNotMatch(latestRoutePanel[0], /home-open-route|Ver ficha/);
    assert.doesNotMatch(dashboardSource, /home-open-route/);
    assert.doesNotMatch(home, /latest-ride-panel|dashboard-latest-panel|home-last-route-path|home-last-route-name|ACTIVIDAD RECIENTE|dashboard-explore-panel|explore-panel|home-route-prompt|Explora tus rutas|Ver mis rutas/);
    const performancePanel = html.match(/<article class="dashboard-panel dashboard-performance-panel"[\s\S]*?<\/article>/);
    assert.ok(performancePanel);
    assert.match(performancePanel[0], /id="home-performance-title">Rendimiento semanal/);
    assert.match(performancePanel[0], /data-dashboard-period="weekly" aria-pressed="true">Semanal/);
    assert.match(performancePanel[0], /data-dashboard-period="monthly" aria-pressed="false">Mensual/);
    assert.match(performancePanel[0], /id="home-performance-foot-label">Salidas esta semana/);
    assert.doesNotMatch(performancePanel[0], /Tu rendimiento|period-pill|7 días/);
    assert.match(html, /id="home-avatar" class="dashboard-avatar" type="button"[^>]*aria-haspopup="dialog"/);
    assert.match(html, /<dialog id="home-avatar-dialog"[\s\S]*id="home-avatar-dialog-image"/);
    assert.doesNotMatch(html, /class="hero-status"/);
    assert.doesNotMatch(html, /dashboard-arrange-toggle|screen-fullscreen-toggle|fullscreen-exit/);
    assert.doesNotMatch(dashboardSource, /dashboardInitCardArrangement|dashboard-arrange-toggle/);
});

test('tapping the latest route preview opens its informational detail', () => {
    const preview = {
        listeners: {},
        addEventListener(name, listener) { this.listeners[name] = listener; }
    };
    const { context } = dashboardContext('TrailRider', '', preview);
    const route = { id: 'latest-route' };
    let opened = null;
    context.dashboardLatestRecordedRoute = () => route;
    context.openSavedRouteDetail = (selectedRoute, options) => {
        opened = { route: selectedRoute, options };
    };

    preview.listeners.click({
        target: {
            closest() { return null; }
        }
    });

    assert.equal(opened.route, route);
    assert.equal(opened.options.viewOnly, true);
});

test('latest route metrics use route analysis and hide when no route exists', () => {
    const { context } = dashboardContext('TrailRider');
    const elements = {
        'home-latest-route-metrics': { hidden: true },
        'home-latest-route-speed': { textContent: '' },
        'home-latest-route-ascent': { textContent: '' },
        'home-latest-route-heart-rate': { textContent: '' },
        'home-latest-route-time': { textContent: '' },
        'home-latest-route-time-label': { textContent: '', title: '' }
    };
    context.$ = id => elements[id] || null;
    context.statsAnalyzeRoute = () => ({
        averageSpeed: 18.6,
        movingTimeSec: 5100,
        movingTimeEstimated: true,
        ascentAvailable: true,
        ascentM: 640,
        averageHr: 152
    });
    context.fmtDur = seconds => `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;

    context.dashboardUpdateLatestRouteMetrics({ distanceKm: 26.4 });

    assert.equal(elements['home-latest-route-metrics'].hidden, false);
    assert.equal(elements['home-latest-route-speed'].textContent, '18.6 km/h');
    assert.equal(elements['home-latest-route-ascent'].textContent, '+640 m');
    assert.equal(elements['home-latest-route-heart-rate'].textContent, '152 ppm');
    assert.equal(elements['home-latest-route-time'].textContent, '1h 25m');
    assert.equal(elements['home-latest-route-time-label'].textContent, 'Tiempo (est.)');
    assert.equal(elements['home-latest-route-time-label'].title, 'Tiempo en movimiento estimado');

    context.statsAnalyzeRoute = () => ({
        averageSpeed: null,
        movingTimeSec: 0,
        movingTimeEstimated: false,
        ascentAvailable: false,
        ascentM: 0,
        averageHr: null
    });
    context.dashboardUpdateLatestRouteMetrics({ distanceKm: 0 });
    assert.equal(elements['home-latest-route-speed'].textContent, '— km/h');
    assert.equal(elements['home-latest-route-ascent'].textContent, '— m');
    assert.equal(elements['home-latest-route-heart-rate'].textContent, '— ppm');
    assert.equal(elements['home-latest-route-time'].textContent, '—');

    context.dashboardUpdateLatestRouteMetrics(null);
    assert.equal(elements['home-latest-route-metrics'].hidden, true);
});

test('home GPS status shows signal quality as up to four bars', () => {
    const { context, gps, mapGps } = dashboardContext('TrailRider');
    context.firstFix = true;
    context.lastAccuracy = 4;
    context.dashboardUpdateGpsStatus();
    assert.equal(gps.attributes['data-gps-quality'], '4');
    assert.equal(mapGps.attributes['data-gps-quality'], '4');
    assert.equal(mapGps.attributes['aria-label'], 'Calidad GPS: Excelente');
    assert.match(gps.innerHTML.replace(/<[^>]+>/g, ''), /GPS · Excelente/);
    assert.match(gps.innerHTML, /class="gps-status-detail"/);
    assert.equal((gps.innerHTML.match(/class="active"/g) || []).length, 4);

    context.lastAccuracy = 25;
    context.dashboardUpdateGpsStatus();
    assert.equal(gps.attributes['data-gps-quality'], '1');
    assert.equal(mapGps.attributes['data-gps-quality'], '1');
    assert.equal((gps.innerHTML.match(/class="active"/g) || []).length, 1);

    context.lastAccuracy = 15;
    context.dashboardUpdateGpsStatus();
    assert.equal(mapGps.attributes['data-gps-quality'], '2');

    context.lastAccuracy = 35;
    context.dashboardUpdateGpsStatus();
    assert.equal(mapGps.attributes['data-gps-quality'], '1');

    context.firstFix = false;
    context.dashboardUpdateGpsStatus();
    assert.equal(mapGps.attributes['data-gps-quality'], '0');
});

test('map banner exposes every top metric as an accessible expand control', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const bannerMetrics = html.match(/<div class="map-live-metrics">([\s\S]*?)<\/section>/);
    assert.ok(bannerMetrics);
    for (const [key, label] of [
        ['elev', 'Desnivel positivo'],
        ['map-distance', 'Distancia recorrida'],
        ['speed', 'Velocidad'],
        ['moving', 'Tiempo en movimiento']
    ]) {
        assert.match(bannerMetrics[1], new RegExp(`data-metric="${key}" role="button" tabindex="0" aria-label="${label}"`));
    }
});

test('map GPS indicator uses a distinct color for each signal quality group', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.css'), 'utf8');
    assert.match(html, /id="map-live-gps" class="map-live-gps"[^>]*aria-label="Calidad GPS: Buscando"/);
    assert.match(styles, /\.map-live-gps\[data-gps-quality="0"\]\s*\{[^}]*color:#7f8993/);
    assert.match(styles, /\.map-live-gps\[data-gps-quality="1"\]\s*\{[^}]*color:#ff554d/);
    assert.match(styles, /\.map-live-gps\[data-gps-quality="2"\]\s*\{[^}]*color:#ffc247/);
    assert.match(styles, /\.map-live-gps\[data-gps-quality="3"\],\.map-live-gps\[data-gps-quality="4"\]\s*\{[^}]*color:#28d17c/);
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
    assert.match(toolsPage, /data-tool="maps"[\s\S]*<strong>Mapas<\/strong>/);
    assert.doesNotMatch(toolsPage, /data-tool="offline-maps"|data-tool="map-style"/);
    const mapsWorkspace = toolsPage.slice(
        toolsPage.indexOf('<section id="maps-workspace"'),
        toolsPage.indexOf('<section id="misc-settings-workspace"')
    );
    assert.match(mapsWorkspace, /Cartografía del mapa[\s\S]*id="map-style-select"/);
    assert.match(mapsWorkspace, /id="offline-panel"[\s\S]*Mapas sin conexión/);
    assert.doesNotMatch(toolsPage, /data-tool="social"|social-workspace|Facebook|Instagram|TikTok/);
    assert.match(toolsPage, /data-tool="misc-settings"[\s\S]*Ajustes varios/);
    for (const id of ['recording-metric-config', 'settings-sensors', 'offline-panel', 'map-style-select', 'setting-route-sound', 'app-version']) {
        assert.ok(toolsPage.includes(`id="${id}"`), `${id} must be in the control center`);
        assert.ok(!settingsPage.includes(`id="${id}"`), `${id} must not remain in Profile`);
    }
    assert.match(toolsPage, /tools-app-version[\s\S]*Aplicación[\s\S]*Versión instalada/);
    assert.match(toolsSource, /case 'maps'[\s\S]*toolsOpenWorkspace\('maps-workspace'\)[\s\S]*openOfflineMaps\(\)/);
    assert.doesNotMatch(toolsSource, /offline-maps-workspace|map-style-workspace|case 'map-style'/);
    assert.doesNotMatch(toolsSource, /case 'social'|social-workspace/);
});

test('home network status follows internet connectivity, independently of server health', () => {
    const { context, network, accountIndicator } = dashboardContext('TrailRider');
    assert.equal(network.classes.connected, true);
    assert.match(network.innerHTML, /En línea/);
    assert.equal(accountIndicator.classes.connected, undefined);

    context.dashboardSetServerStatus('connected');
    context.navigator.onLine = false;
    context.dashboardUpdateNetworkStatus();
    assert.equal(network.classes.connected, false);
    assert.equal(network.classes.offline, true);
    assert.match(network.innerHTML, /Sin conexión/);
    assert.equal(accountIndicator.classes.connected, true);
    assert.equal(accountIndicator.classes.offline, false);
    assert.equal(accountIndicator.attributes['aria-label'], 'Estado del servidor: conectado');
});

test('server indicator reflects the PocketBase health endpoint response', async () => {
    const { context, accountIndicator } = dashboardContext('TrailRider');
    let requestedUrl = '';
    context.fetch = async (url, options) => {
        requestedUrl = url;
        assert.equal(options.cache, 'no-store');
        return { ok: true };
    };

    assert.equal(await context.dashboardCheckServerStatus(), true);
    assert.equal(requestedUrl, 'https://server.example/api/health');
    assert.equal(accountIndicator.classes.connected, true);
    assert.equal(accountIndicator.label.textContent, 'Conectado');

    context.fetch = async () => { throw new Error('server unavailable'); };
    assert.equal(await context.dashboardCheckServerStatus(), false);
    assert.equal(accountIndicator.classes.offline, true);
    assert.equal(accountIndicator.attributes['aria-label'], 'Estado del servidor: sin conexión');
});

test('profile hides the synchronization server URL and shows the illuminated server status', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.doesNotMatch(html, /id="acc-server"|Servidor de sincronización:/);
    assert.match(html, /id="acc-server-status" class="account-server-status profile-server-status"[^>]*role="status"[^>]*aria-label="Estado del servidor"[\s\S]*<span>Servidor<\/span>/);
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

test('home keeps the 3D route visible while the satellite map loads', () => {
    const { context } = dashboardContext('TrailRider');
    const makeElement = () => ({
        attributes: {},
        children: [],
        isConnected: true,
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(child) {
            child.parent = this;
            this.children.push(child);
            return child;
        },
        remove() {
            if (!this.parent) return;
            this.parent.children = this.parent.children.filter(child => child !== this);
            this.isConnected = false;
        }
    });
    const container = {
        children: [],
        replaceChildren(...children) {
            this.children.forEach(child => { child.isConnected = false; });
            this.children = [];
            children.forEach(child => this.appendChild(child));
        },
        appendChild(child) {
            child.parent = this;
            this.children.push(child);
            return child;
        },
    };
    const fallback = makeElement();
    const mapElement = makeElement();
    let mapLoad;
    let routeSource;
    const map = {
        once(event, listener) { if (event === 'load') mapLoad = listener; },
        on() {},
        getContainer() { return mapElement; },
        addSource(id, source) { if (id === 'latest-route') routeSource = source; },
        addLayer() {},
        fitBounds() {},
        resize() {},
        remove() {}
    };
    context.$ = id => id === 'home-map' ? container : null;
    context.document.createElement = () => mapElement;
    context.routeNameWithoutActivity = () => 'Ruta de prueba';
    context.createRouteRelief3D = () => fallback;
    context.window.maplibregl = {
        Map: function () { return map; },
        LngLatBounds: function () {}
    };

    const route = {
        id: 1,
        points: [
            [40, -3],
            [40.001, -3.001]
        ]
    };
    assert.equal(context.dashboardCreateTerrainMap(route, container, 'route-1'), true);
    assert.ok(container.children.includes(fallback), 'el recorrido local debe seguir visible mientras carga el mapa');

    mapLoad();

    assert.deepEqual(
        JSON.parse(JSON.stringify(routeSource.data.geometry.coordinates)),
        [[-3, 40], [-3.001, 40.001]]
    );
    assert.ok(!container.children.includes(fallback), 'la vista local se retira cuando el mapa ya muestra el recorrido');
});
