'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'sensors.js'), 'utf8');

function element(id) {
    return {
        id, checked: false, disabled: false, hidden: false, textContent: '', value: '2100', style: {},
        children: [], listeners: {}, dataset: {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
        replaceChildren() { this.children = []; },
        append(...items) { this.children.push(...items); },
        setAttribute() {},
        closest() { return null; }
    };
}

function sensorsContext({ storage = {}, available = true } = {}) {
    const values = new Map(Object.entries(storage));
    const elements = new Map();
    const timers = [];
    const toasts = [];
    const connects = [];
    let disconnectHandlers = {};
    const ble = {
        init: async () => {},
        isEnabled: async () => true,
        pick: async () => { throw new Error('cancelled'); },
        async connect(id, onValue, onDisconnect) {
            connects.push(['hr', id]);
            if (!available) throw new Error('timeout');
            disconnectHandlers.hr = onDisconnect;
            return { id };
        },
        async connectCsc(id, onValue, onDisconnect) { connects.push(['csc', id]); disconnectHandlers.csc = onDisconnect; return { id }; },
        async connectPower(id, onValue, onDisconnect) { connects.push(['power', id]); return { id }; },
        async disconnectCharacteristic() {}
    };
    const document = {
        hidden: false,
        listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
        createElement: tag => element(tag)
    };
    const context = vm.createContext({
        console: { warn() {} },
        localStorage: {
            getItem: key => values.has(key) ? values.get(key) : null,
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: key => values.delete(key)
        },
        document,
        window: { Capacitor: { isNativePlatform: () => true }, MtbBle: ble },
        $: id => { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
        toast: message => toasts.push(message),
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout: () => {},
        currentHr: null, currentCadence: null, currentPower: null, currentBleSpeed: null, currentBleSpeedAt: 0,
        isRecording: false
    });
    vm.runInContext(source, context);
    const runTimers = async () => {
        const pending = timers.splice(0);
        for (const timer of pending) await timer.fn();
        await new Promise(resolve => setImmediate(resolve));
    };
    return { context, values, elements, timers, toasts, connects, runTimers, document, ble, setAvailable: v => { available = v; }, disconnectHandlers: () => disconnectHandlers };
}

test('sensor registry keeps valid entries and migrates the legacy heart-rate device', () => {
    const { context } = sensorsContext();
    const registry = JSON.parse(JSON.stringify(context.normalizeSensorRegistry(
        { cadence: { id: 'AA:BB', name: 'Garmin', enabled: false }, power: { id: '' }, bogus: { id: 'x' } },
        { id: 'HR:01', name: 'Polar H10' }
    )));
    assert.deepEqual(registry, {
        hr: { id: 'HR:01', name: 'Polar H10', enabled: true },
        cadence: { id: 'AA:BB', name: 'Garmin', enabled: false }
    });
});

test('reconnect delay backs off from 5 s up to 30 s', () => {
    const { context } = sensorsContext();
    assert.deepEqual([0, 1, 2, 3, 8].map(context.sensorReconnectDelay), [5000, 10000, 20000, 30000, 30000]);
});

test('registered sensors connect on start-up without opening the device picker', async () => {
    const { context, runTimers, connects, elements } = sensorsContext({
        storage: { mtb_pro_ble_sensors_v1: JSON.stringify({ hr: { id: 'HR:01', name: 'Polar H10', enabled: true }, cadence: { id: 'CAD', name: 'Wahoo', enabled: false } }) }
    });
    context.initSensorConnections();
    assert.equal(elements.get('sensor-hr-enabled').checked, true);
    assert.match(elements.get('sensor-hr-status').textContent, /Esperando a Polar H10/);
    await runTimers();
    assert.deepEqual(connects, [['hr', 'HR:01']]);
    assert.equal(elements.get('sensor-hr-status').textContent, 'Conectado: Polar H10');
    assert.equal(elements.get('sensor-cadence-enabled').checked, false);
});

test('a lost sensor keeps retrying until it is available again', async () => {
    const ctx = sensorsContext({
        storage: { mtb_pro_ble_sensors_v1: JSON.stringify({ hr: { id: 'HR:01', name: 'Polar H10' } }) }
    });
    ctx.context.initSensorConnections();
    await ctx.runTimers();
    ctx.setAvailable(false);
    ctx.disconnectHandlers().hr('HR:01');
    assert.match(ctx.elements.get('sensor-hr-status').textContent, /Esperando a Polar H10/);
    for (let i = 0; i < 6; i++) await ctx.runTimers();
    assert.equal(ctx.connects.length, 7);
    assert.equal(ctx.timers.at(-1).ms, 30000);
    ctx.setAvailable(true);
    await ctx.runTimers();
    assert.equal(ctx.elements.get('sensor-hr-status').textContent, 'Conectado: Polar H10');
    assert.ok(ctx.toasts.some(message => /Se reconectará cuando esté disponible/.test(message)));
});

test('turning a sensor off stops reconnection and forgetting removes it', async () => {
    const ctx = sensorsContext({
        storage: { mtb_pro_ble_sensors_v1: JSON.stringify({ hr: { id: 'HR:01', name: 'Polar H10' } }) }
    });
    ctx.context.initSensorConnections();
    await ctx.context.disableSensor('hr');
    await ctx.runTimers();
    assert.equal(ctx.connects.length, 0);
    assert.equal(JSON.parse(ctx.values.get('mtb_pro_ble_sensors_v1')).hr.enabled, false);
    await ctx.context.disableSensor('hr', { forget: true });
    assert.deepEqual(JSON.parse(ctx.values.get('mtb_pro_ble_sensors_v1')), {});
});

test('a manual connection supersedes an automatic attempt and closes its stale subscription', async () => {
    const ctx = sensorsContext({
        storage: { mtb_pro_ble_sensors_v1: JSON.stringify({ hr: { id: 'HR:01', name: 'Polar H10' } }) }
    });
    const closed = [];
    let releaseAuto;
    let firstValue;
    ctx.ble.connect = (id, onValue) => {
        ctx.connects.push(['hr', id]);
        if (ctx.connects.length === 1) {
            firstValue = onValue;
            return new Promise(resolve => { releaseAuto = () => resolve({ id, stale: true }); });
        }
        return Promise.resolve({ id, stale: false });
    };
    ctx.ble.disconnectCharacteristic = async (id, service, characteristic, subscription) => { closed.push(subscription); };
    ctx.context.initSensorConnections();
    const auto = ctx.runTimers();
    await new Promise(resolve => setImmediate(resolve));
    await ctx.context.enableSensor('hr');
    assert.equal(ctx.elements.get('sensor-hr-status').textContent, 'Conectado: Polar H10');
    releaseAuto();
    await auto;
    assert.equal(closed.length, 1);
    assert.equal(closed[0].stale, true);
    firstValue(150);
    assert.notEqual(ctx.context.$('m-hr').textContent, 150);
    assert.equal(ctx.elements.get('sensor-hr-status').textContent, 'Conectado: Polar H10');
});
