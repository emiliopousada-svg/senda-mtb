'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const cockpitSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'cockpit.js'), 'utf8');

function cockpitContext() {
    const elements = new Map();
    const clicks = { start: 0, finish: 0 };
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
        ['recording-live-altitude', '620 m'], ['recording-live-hint', '600–640 m · últimas lecturas'],
        ['recording-live-line', ''], ['recording-live-area', ''],
        ['cockpit-time'], ['cockpit-distance'], ['cockpit-elevation'], ['cockpit-avg-speed'], ['cockpit-moving'],
        ['cockpit-heart-rate'], ['cockpit-cadence'], ['cockpit-power'], ['cockpit-speed'],
        ['cockpit-speed-gauge'], ['cockpit-recording-state'], ['cockpit-toggle-label'], ['cockpit-toggle-icon'],
        ['cockpit-finish'], ['cockpit-gps-status'], ['cockpit-network-status'], ['cockpit-network-label'],
        ['cockpit-profile-altitude'], ['cockpit-elevation-range'], ['cockpit-profile-line'],
        ['cockpit-profile-area'], ['cockpit-profile-empty'], ['cockpit-route-line'], ['cockpit-route-start'],
        ['cockpit-route-end'], ['cockpit-route-empty'], ['cockpit-route-title'], ['cockpit-toggle'],
        ['btn-start'], ['btn-stop']
    ].forEach(([id, text]) => elements.set(id, makeElement(text)));
    elements.get('dashboard-gps-status').classList.toggle('ready', true);
    elements.get('dashboard-network-status').classList.toggle('connected', true);
    elements.get('recording-live-line').setAttribute('d', 'M0,40 L320,10');
    elements.get('recording-live-area').setAttribute('d', 'M0,40 L320,10 L320,48 L0,48 Z');
    elements.get('btn-start').click = () => { clicks.start += 1; };
    elements.get('btn-stop').click = () => { clicks.finish += 1; };

    const context = vm.createContext({
        $: id => elements.get(id) || null,
        points: [[12.1, 104.1], [12.2, 104.3]],
        isRecording: true,
        isPaused: false,
        MutationObserver: class { observe() {} }
    });
    vm.runInContext(cockpitSource, context);
    return { context, elements, clicks };
}

test('cockpit mirrors ride metrics, live status and route into its own view', () => {
    const { elements } = cockpitContext();
    assert.equal(elements.get('cockpit-speed').textContent, '21.4');
    assert.equal(elements.get('cockpit-distance').textContent, '4.25');
    assert.equal(elements.get('cockpit-heart-rate').textContent, '152');
    assert.equal(elements.get('cockpit-recording-state').textContent, 'Grabando salida');
    assert.equal(elements.get('cockpit-toggle-label').textContent, 'Pausar salida');
    assert.equal(elements.get('cockpit-finish').hidden, false);
    assert.equal(elements.get('cockpit-gps-status').textContent, 'GPS · Buena');
    assert.equal(elements.get('cockpit-network-label').textContent, 'En línea');
    assert.equal(elements.get('cockpit-network-status').classList.contains('connected'), true);
    assert.equal(elements.get('cockpit-profile-line').getAttribute('d'), 'M0,40 L320,10');
    assert.match(elements.get('cockpit-route-line').getAttribute('d'), /^M/);
    assert.equal(elements.get('cockpit-route-empty').hidden, true);
});

test('cockpit forwards recording controls and reflects paused state', () => {
    const { context, elements, clicks } = cockpitContext();
    elements.get('cockpit-toggle').handlers.click();
    elements.get('cockpit-finish').handlers.click();
    assert.equal(clicks.start, 1);
    assert.equal(clicks.finish, 1);

    context.isPaused = true;
    context.cockpitRender();
    assert.equal(elements.get('cockpit-recording-state').textContent, 'Salida pausada');
    assert.equal(elements.get('cockpit-toggle-label').textContent, 'Reanudar salida');
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

test('cockpit sits between home and tools and maps back to the existing map navigation', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const home = html.indexOf('id="page-home"');
    const cockpit = html.indexOf('id="page-cockpit"');
    const tools = html.indexOf('id="page-tools"');
    const mapControls = html.match(/<div class="side-controls">([\s\S]*?)<\/div>\s*<div class="controls-overlay">/);
    assert.ok(home < cockpit && cockpit < tools);
    assert.match(html, /data-page="6"[^>]*>Cockpit<\/button>/);
    assert.match(html, /id="page-cockpit"[\s\S]*data-page="0">Abrir mapa/);
    assert.ok(mapControls);
    assert.match(mapControls[1], /id="btn-map-cockpit"[^>]*data-page="6"[^>]*aria-label="Volver al Cockpit"/);
});
