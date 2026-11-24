'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const cockpitSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'cockpit.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'ui.js'), 'utf8');

function cockpitContext() {
    const elements = new Map();
    const observers = [];
    const makeElement = (textContent = '') => {
        const attributes = {};
        const classes = new Set();
        const handlers = {};
        return {
            textContent,
            hidden: false,
            disabled: false,
            dataset: {},
            style: { setProperty(name, value) { this[name] = value; } },
            classList: {
                contains(name) { return classes.has(name); },
                toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }
            },
            addEventListener(name, handler) { handlers[name] = handler; },
            click() { this.clickCount = (this.clickCount || 0) + 1; },
            setAttribute(name, value) { attributes[name] = value; },
            getAttribute(name) { return attributes[name] || ''; },
            handlers
        };
    };
    [
        ['m-time', '10:32'], ['m-dist', '4.25'], ['m-elevation', '120'],
        ['m-avg-speed', '13.2'], ['m-moving', '09:04'], ['m-hr', '152'],
        ['m-cadence', '82'], ['m-power', '210'], ['m-speed', '21.4'],
        ['dashboard-gps-status', 'GPS · Buena'], ['dashboard-network-status', 'En línea'],
        ['cockpit-time'], ['cockpit-distance'], ['cockpit-elevation'], ['cockpit-avg-speed'], ['cockpit-moving'],
        ['cockpit-heart-rate'], ['cockpit-cadence'], ['cockpit-power'], ['cockpit-speed'],
        ['page-cockpit'], ['cockpit-oled-toggle'], ['cockpit-oled-status'],
        ['cockpit-sensor-hr'], ['cockpit-sensor-cadence'], ['cockpit-sensor-power'],
        ['sensor-hr-status'], ['sensor-cadence-status'], ['sensor-power-status'],
        ['cockpit-speed-panel'], ['cockpit-speed-gauge'], ['cockpit-recording-state'],
        ['cockpit-gps-status'], ['cockpit-gps-label'], ['cockpit-network-status'], ['cockpit-network-label'],
    ].forEach(([id, text]) => elements.set(id, makeElement(text)));
    elements.get('dashboard-gps-status').classList.toggle('ready', true);
    elements.get('dashboard-gps-status').setAttribute('data-gps-quality', '3');
    elements.get('dashboard-gps-status').setAttribute('aria-label', 'Calidad GPS: Buena, 3 de 4 barras');
    elements.get('dashboard-network-status').classList.toggle('connected', true);
    const body = makeElement();
    const savedPreferences = new Map();
    const context = vm.createContext({
        $: id => elements.get(id) || null,
        document: { body },
        currentPage: 6,
        localStorage: {
            getItem(key) { return savedPreferences.get(key) || null; },
            setItem(key, value) { savedPreferences.set(key, value); }
        },
        toast() {},
        screenScheduleDim() {},
        isRecording: true,
        isPaused: false,
        sensorStates: {
            hr: { connected: true },
            cadence: { connected: false },
            power: { connected: true }
        },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
            observe(element) { this.targets.push(element); }
        }
    });
    vm.runInContext(cockpitSource, context);
    return { context, elements, observers, body, savedPreferences };
}

test('cockpit mirrors ride metrics, live status and route into its own view', () => {
    const { context, elements, observers } = cockpitContext();
    assert.equal(elements.get('cockpit-speed').textContent, '21.4');
    assert.equal(elements.get('cockpit-speed-panel').dataset.speedBand, 'yellow');
    assert.equal(elements.get('cockpit-distance').textContent, '4.25');
    assert.equal(elements.get('cockpit-heart-rate').textContent, '152');
    assert.equal(elements.get('cockpit-sensor-hr').classList.contains('connected'), true);
    assert.equal(elements.get('cockpit-sensor-cadence').classList.contains('connected'), false);
    assert.equal(elements.get('cockpit-sensor-power').classList.contains('connected'), true);
    assert.ok(observers[0].targets.includes(elements.get('sensor-cadence-status')));
    context.sensorStates.cadence.connected = true;
    observers[0].callback();
    assert.equal(elements.get('cockpit-sensor-cadence').classList.contains('connected'), true);
    assert.equal(elements.get('cockpit-recording-state').textContent, 'Grabando ruta');
    assert.equal(elements.get('cockpit-gps-label').textContent, 'GPS · Buena');
    assert.equal(elements.get('cockpit-gps-status').dataset.gpsQuality, '3');
    assert.equal(elements.get('cockpit-gps-status').classList.contains('ready'), true);
    assert.equal(elements.get('cockpit-network-label').textContent, 'En línea');
    assert.equal(elements.get('cockpit-network-status').classList.contains('connected'), true);
    elements.get('dashboard-gps-status').textContent = 'GPS · Débil';
    elements.get('dashboard-gps-status').setAttribute('data-gps-quality', '1');
    elements.get('dashboard-gps-status').setAttribute('aria-label', 'Calidad GPS: Débil, 1 de 4 barras');
    observers[0].callback();
    assert.equal(elements.get('cockpit-gps-label').textContent, 'GPS · Débil');
    assert.equal(elements.get('cockpit-gps-status').dataset.gpsQuality, '1');
    context.isRecording = false;
    context.sensorStates.hr.connected = false;
    context.cockpitRender();
    assert.equal(elements.get('cockpit-recording-state').textContent, 'Sin grabar');
    assert.equal(elements.get('cockpit-sensor-hr').classList.contains('connected'), false);
});

test('cockpit omits the elevation and route preview block entirely', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<span>ALTIMETRÍA<\/span>/);
    assert.doesNotMatch(html, /<span>TRAZADO<\/span>/);
    assert.doesNotMatch(html, /cockpit-(?:visuals|chart-wrap|route-preview|profile-line|route-line|map-link)/);
});

test('cockpit speedometer changes color band at each speed threshold', () => {
    const { context, elements } = cockpitContext();
    [
        [0, 'blue'], [7.9, 'blue'], [8, 'green'], [14.9, 'green'],
        [15, 'yellow'], [24.9, 'yellow'], [25, 'orange'], [39.9, 'orange'],
        [40, 'red'], [60, 'red'], [72, 'red']
    ].forEach(([speed, band]) => {
        elements.get('m-speed').textContent = String(speed);
        context.cockpitRender();
        assert.equal(elements.get('cockpit-speed-panel').dataset.speedBand, band, `${speed} km/h`);
    });
});

test('cockpit reflects paused recording state without showing recording controls', () => {
    const { context, elements } = cockpitContext();
    context.isPaused = true;
    context.cockpitRender();
    assert.equal(elements.get('cockpit-recording-state').textContent, 'Grabación pausada');
});

test('cockpit OLED saver button persists its state and updates its accessible status', () => {
    const { elements, body, savedPreferences } = cockpitContext();
    const button = elements.get('cockpit-oled-toggle');

    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(elements.get('page-cockpit').classList.contains('oled-saver'), false);

    button.handlers.click();
    assert.equal(savedPreferences.get('mtb_pro_oled_saver'), '1');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(button.getAttribute('aria-label'), 'Desactivar ahorro OLED');
    assert.equal(elements.get('cockpit-oled-status').textContent, 'ON');
    assert.equal(elements.get('page-cockpit').classList.contains('oled-saver'), true);
    assert.equal(body.classList.contains('cockpit-oled-saver'), true);

    button.handlers.click();
    assert.equal(savedPreferences.get('mtb_pro_oled_saver'), '0');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(body.classList.contains('cockpit-oled-saver'), false);
});

test('cockpit switches the connection indicator to offline styling when disconnected', () => {
    const { context, elements } = cockpitContext();
    const network = elements.get('dashboard-network-status');
    network.textContent = 'Sin conexión';
    network.classList.toggle('connected', false);
    network.classList.toggle('offline', true);

    context.cockpitRender();
    assert.equal(elements.get('cockpit-network-label').textContent, 'Sin conexión');
    assert.equal(elements.get('cockpit-network-status').classList.contains('connected'), false);
    assert.equal(elements.get('cockpit-network-status').classList.contains('offline'), true);
});

test('cockpit sits between home and tools and uses app navigation without a home button', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const home = html.indexOf('id="page-home"');
    const cockpit = html.indexOf('id="page-cockpit"');
    const tools = html.indexOf('id="page-tools"');
    const mapControls = html.match(/<div class="side-controls">([\s\S]*?)<\/div>\s*<div class="map-bottom-panel" id="map-bottom-panel">/);
    assert.ok(home < cockpit && cockpit < tools);
    assert.match(html, /<h1 class="cockpit-title">[\s\S]*class="cockpit-title-brand">SENDA-MTB<\/span>[\s\S]*class="cockpit-title-caption">COCKPIT<\/span>/);
    assert.doesNotMatch(html, /Tu salida, de un vistazo|CONTROLES DE SALIDA/);
    assert.match(html, /<div class="cockpit-status-row"[^>]*>\s*<span id="cockpit-recording-state"/);
    assert.match(html, /<div class="cockpit-status-row"[\s\S]*<button class="cockpit-oled-toggle"[\s\S]*id="cockpit-oled-status"[\s\S]*<\/button>\s*<\/div>/);
    assert.doesNotMatch(html, /class="cockpit-back"|← Inicio/);
    assert.match(html, /data-page="6"[^>]*>Cockpit<\/button>/);
    assert.doesNotMatch(html, /id="page-cockpit"[\s\S]*Abrir mapa/);
    assert.doesNotMatch(html, /class="cockpit-controls"|id="cockpit-toggle"|id="cockpit-finish"|Iniciar salida|Finalizar y guardar/);
    assert.doesNotMatch(html, /cockpit-gps-signal-bars/);
    assert.ok(mapControls);
    assert.match(mapControls[1], /id="btn-map-cockpit"[^>]*data-page="6"[^>]*aria-label="Volver al Cockpit"/);
});

test('cockpit uses compact layout when the phone is in landscape', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.css'), 'utf8');
    assert.match(css, /\.cockpit-title-brand\s*\{[^}]*font-size:clamp\(1rem,5\.5vw,2rem\)/);
    assert.match(css, /@media \(orientation: landscape\) and \(max-width:1280px\) and \(max-height:600px\)/);
    assert.match(css, /\.cockpit-speed-gauge\s*\{[\s\S]*?width:min\(21dvh,150px\)/);
    assert.match(css, /\.cockpit-performance\s*\{[\s\S]*?grid-template-columns:minmax\(210px,\.72fr\)/);
    assert.doesNotMatch(css, /cockpit-visuals|cockpit-chart-wrap|cockpit-route-preview/);
    assert.match(css, /#cockpit-gps-status\[data-gps-quality="1"\]\s*\{[^}]*color:#ff8585/);
    assert.match(css, /#cockpit-gps-status\[data-gps-quality="4"\]\s*\{[^}]*color:#83e3ab/);
    assert.match(css, /#cockpit-gps-status\[data-gps-quality="1"\]::before\s*\{[^}]*background:#ff6565/);
    assert.match(css, /#cockpit-gps-status\[data-gps-quality="4"\]::before\s*\{[^}]*background:#35d17a/);
    assert.match(css, /\.cockpit-status-row\s*\{[^}]*justify-content:center/);
});

test('live elevation profile is removed from the map while route profile remains styled', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.css'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.doesNotMatch(html, /recording-live-profile|recording-live-(?:altitude|hint|line|area)/);
    assert.doesNotMatch(css, /#page-map[^}]*#recording-live-profile/);
    assert.match(css, /#page-map #map-bottom-panel #map-route-profile\s*\{[\s\S]*?position: relative/);
});

test('collapsing the map panel keeps ride metrics visible and hides its actions', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.css'), 'utf8');
    assert.match(css, /#page-map\.panel-collapsed \.map-bottom-panel-content\s*\{[^}]*display:flex/);
    assert.match(css, /#page-map\.panel-collapsed \.map-bottom-panel \.controls-overlay\s*\{[^}]*display:none/);
    assert.match(css, /#page-map\.panel-collapsed \.map-bottom-panel \.map-live-stat\s*\{[^}]*min-height:46px/);
    assert.doesNotMatch(css, /#page-map\.panel-collapsed[^}]*\.map-bottom-panel\s*\{[^}]*opacity:0/);
});

test('map lower panel omits altitude and centers the remaining metric values', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.css'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.doesNotMatch(html, /data-metric="map-altitude"|id="map-panel-altitude"/);
    assert.match(html, /data-metric="map-total-time"[\s\S]*data-metric="map-heart-rate"[\s\S]*data-metric="map-cadence"/);
    assert.match(css, /\.map-bottom-panel \.map-live-stat\s*\{[^}]*align-items:center;[^}]*justify-content:center;[^}]*text-align:center;/);
    assert.match(css, /\.map-bottom-panel \.map-live-stat \.m-val,\.map-bottom-panel \.map-live-stat \.m-lbl\s*\{[^}]*width:100%;[^}]*text-align:center;/);
    assert.match(css, /\.map-bottom-panel \.metrics-bar\s*\{[^}]*repeat\(var\(--recording-metric-columns,3\)/);
    assert.match(css, /#page-map\.panel-collapsed \.map-bottom-panel \.metrics-bar\s*\{[^}]*repeat\(3,minmax\(0,1fr\)\)/);
});

test('collapsed map panel contributes to the map stack height', () => {
    const styles = new Map();
    const observers = [];
    const makeElement = ({ top = 0, height = 0, offsetParent = {} } = {}) => ({
        textContent: '',
        hidden: false,
        style: { setProperty(name, value) { styles.set(name, value); } },
        classList: {
            contains(name) { return name === 'panel-collapsed'; },
            toggle() {}
        },
        addEventListener() {},
        setAttribute() {},
        getBoundingClientRect() { return { top, bottom: top + height, height }; },
        querySelector(selector) { return selector === '.side-controls' || selector === '.map-zoom-controls' ? makeElement() : null; }
    });
    const elements = new Map([
        ['page-map', makeElement({ height: 500 })],
        ['map-bottom-panel', makeElement({ top: 460, height: 40 })],
        ['map-route-profile', makeElement({ top: 500, offsetParent: null })]
    ]);
    const document = {
        querySelector(selector) {
            return selector === '.map-recording-actions' ? makeElement() : makeElement();
        },
        querySelectorAll() { return []; }
    };
    const context = vm.createContext({
        $: id => elements.get(id) || makeElement(),
        document,
        isRecording: false,
        followedRoute: null,
        ResizeObserver: class {
            constructor(callback) { observers.push(callback); }
            observe() {}
        },
        MutationObserver: class {
            observe() {}
        }
    });
    vm.runInContext(uiSource, context);

    context.initMetricPanel();
    observers[0]();

    assert.equal(styles.get('--map-stack-h'), '40px');
});
