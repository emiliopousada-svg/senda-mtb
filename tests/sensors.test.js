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
        isRecording: false, isPaused: false, recordingActivityType: 'mtb', totalDistance: 0
    });
    vm.runInContext(source, context);
    vm.runInContext('globalThis.sensorStatesForTest = sensorStates;', context);
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

test('cadence expires to zero while the sensor remains connected', () => {
    const { context, elements } = sensorsContext();
    const state = context.sensorStatesForTest.cadence;
    state.connected = true;
    state.lastCadenceAt = Date.now() - 6000;
    context.currentCadence = 86;

    context.expireSensorReading('cadence', state.lastCadenceAt);

    assert.equal(context.currentCadence, 0);
    assert.equal(elements.get('m-cadence').textContent, '0');
});

test('BLE speed expires based on the timestamp of its last valid wheel reading', () => {
    const { context } = sensorsContext();
    const state = context.sensorStatesForTest.speed;
    const readingAt = Date.now() - 6000;
    state.connected = true;
    context.currentBleSpeed = 18;
    context.currentBleSpeedAt = readingAt;
    let displayUpdates = 0;
    context.updateSpeedDisplay = () => { displayUpdates++; };

    context.expireSensorReading('speed', readingAt);

    assert.equal(context.currentBleSpeed, null);
    assert.equal(context.currentBleSpeedAt, 0);
    assert.equal(displayUpdates, 1);
});

test('BLE speed expiry timer uses the remaining five-second reading lifetime', () => {
    const { context, timers } = sensorsContext();
    const readingAt = Date.now() - 4900;
    context.currentBleSpeed = 18;
    context.currentBleSpeedAt = readingAt;

    context.scheduleSensorReadingExpiry('speed');

    assert.ok(timers[0].ms > 0);
    assert.ok(timers[0].ms <= 200);
});

test('BLE wheel readings update speed without changing GPS route distance', () => {
    let displayUpdates = 0;
    const ctx = sensorsContext();
    ctx.context.isRecording = true;
    ctx.context.updateSpeedDisplay = () => { displayUpdates++; };
    const state = ctx.context.sensorStatesForTest.speed;
    state.connected = true;
    state.previous = { wheelRevolutions: 100, wheelEventTime: 1000 };

    ctx.context.applyCscReading('speed', { wheelRevolutions: 103, wheelEventTime: 4072 });

    assert.ok(Math.abs(ctx.context.currentBleSpeed - 7.56) < 0.01);
    assert.equal(ctx.context.totalDistance, 0);
    assert.equal(displayUpdates, 1);
});

test('BLE wheel readings reconstruct a 64-second event-time wrap after a long notification gap', () => {
    const ctx = sensorsContext();
    const state = ctx.context.sensorStatesForTest.speed;
    state.previous = { wheelRevolutions: 100, wheelEventTime: 1000 };
    state.previousReceivedAt = Date.now() - 65000;

    ctx.context.applyCscReading('speed', { wheelRevolutions: 400, wheelEventTime: 2024 });

    assert.ok(Math.abs(ctx.context.currentBleSpeed - 34.86) < 0.1);
    assert.equal(ctx.context.totalDistance, 0);
});

test('BLE wheel readings outside the valid speed range do not update speed or distance', () => {
    const ctx = sensorsContext();
    const state = ctx.context.sensorStatesForTest.speed;
    state.previous = { wheelRevolutions: 100, wheelEventTime: 1000 };
    state.previousReceivedAt = Date.now() - 65000;

    ctx.context.applyCscReading('speed', { wheelRevolutions: 1300, wheelEventTime: 2024 });

    assert.equal(ctx.context.currentBleSpeed, null);
    assert.equal(ctx.context.totalDistance, 0);
    assert.equal(ctx.context.$('sensor-speed-status').textContent, '');
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
