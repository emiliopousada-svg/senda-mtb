const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadConfigContext() {
    const elements = new Map();
    const makeEl = id => {
        const el = {
            id,
            textContent: '',
            value: '',
            hidden: false,
            style: {},
            dataset: {},
            attributes: {},
            classList: {
                set: new Set(),
                add(c) { this.set.add(c); },
                remove(c) { this.set.delete(c); },
                contains(c) { return this.set.has(c); }
            },
            setAttribute(k, v) { this.attributes[k] = v; },
            focus() {},
            select() {},
            click() { if (typeof this.onclick === 'function') this.onclick(); }
        };
        elements.set(id, el);
        return el;
    };
    ['modal', 'modal-input', 'modal-ok', 'modal-cancel', 'modal-eyebrow', 'modal-title', 'modal-msg']
        .forEach(makeEl);
    const context = vm.createContext({
        document: { getElementById: id => elements.get(id) || null },
        setTimeout,
        clearTimeout,
        Object,
        Promise,
        Math,
        Number,
        String,
        Array,
        Error,
        URL
    });
    const configSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'config.js'), 'utf8');
    vm.runInContext(configSource, context);
    return { context, elements };
}

test('modal queues concurrent calls instead of hanging the first promise', async () => {
    const { context, elements } = loadConfigContext();
    const p1 = context.modal({ message: 'First?', ok: 'Yes', cancel: 'No' });
    const p2 = context.modal({ message: 'Second?', ok: 'Save', cancel: 'Skip' });

    await new Promise(r => setTimeout(r, 10));
    assert.equal(elements.get('modal-msg').textContent, 'First?');
    elements.get('modal-ok').click();
    assert.equal(await p1, true);

    await new Promise(r => setTimeout(r, 10));
    assert.equal(elements.get('modal-msg').textContent, 'Second?');
    elements.get('modal-cancel').click();
    assert.equal(await p2, false);
});

test('pauseRecording ignores duplicate calls and negative elapsed deltas', () => {
    const recordingSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'recording.js'), 'utf8');
    const context = vm.createContext({
        isRecording: true,
        isPaused: false,
        autoPaused: false,
        segStart: 5000,
        movingMs: 1000,
        autoPauseLastMovementAt: 2000,
        autoPauseLastPosition: null,
        autoPauseAnchor: null,
        autoPauseResumeCandidate: null,
        autoPauseInterval: null,
        timerInterval: null,
        draftInterval: null,
        rideAdvisoryToken: 0,
        batteryCheckInterval: null,
        rideBattery: null,
        nativeBatteryInfo: null,
        startedAt: '2026-11-24T10:00:00Z',
        totalDistance: 0,
        AUTO_PAUSE_AFTER_MS: 20000,
        btnStart: { classList: { toggle() {} }, addEventListener() {} },
        lblStart: { textContent: '' },
        icoStart: { textContent: '' },
        fmtClock: () => '00:00',
        followedRoute: null,
        navigator: {},
        localStorage: { getItem: () => '1' },
        $: () => ({ textContent: '', classList: { toggle() {}, remove() {} }, dataset: {}, addEventListener() {} }),
        refreshGpsMode() {},
        stopAutoPauseMonitor() {},
        pauseTimers() {},
        stopRideAdvisories() {},
        releaseWake() {},
        stopBgWatcher() {},
        removeMyLiveLocation() {},
        setBtnState() {},
        scheduleDraftSave() {},
        safetyRender() {},
        toast() {},
        Date: { now: () => 6000, parse: Date.parse },
        Math,
        Number,
        Object,
        Array,
        Promise,
        setInterval: () => 1,
        clearInterval() {},
        setTimeout,
        clearTimeout
    });
    vm.runInContext(recordingSource, context);
    context.setBtnState = () => {};
    context.scheduleDraftSave = () => {};

    context.pauseRecording(true);
    assert.equal(context.isPaused, true);
    assert.equal(context.movingMs, 1000);
    assert.equal(context.segStart, null);

    // Calling pauseRecording again while already paused must not add Date.now()
    context.pauseRecording(false);
    assert.equal(context.movingMs, 1000);
});

test('parseTrack rejects invalid GeoJSON coordinates and malformed collections safely', () => {
    const routeFilesSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'route-files.js'), 'utf8');
    const context = vm.createContext({
        Array,
        Number,
        String,
        Error,
        JSON,
        DOMParser: class {}
    });
    vm.runInContext(routeFilesSource, context);

    // Malformed FeatureCollection with missing features array does not crash
    const emptyFc = context.parseTrack('{"type":"FeatureCollection","features":null}', 'bad.geojson');
    assert.equal(emptyFc.segs.length, 0);

    // Out-of-range coordinates in GeoJSON are rejected explicitly
    assert.throws(
        () => context.parseTrack('{"type":"LineString","coordinates":[[999,42],[10,42]]}', 'bad.geojson'),
        /coordenada geográfica no válida/
    );
});

test('communityTrackBounds handles 100,000 points without stack overflow', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-routes.js'), 'utf8')
        .replace(/initCommunityRoutes\(\);\s*$/, '');
    const context = vm.createContext({
        Array,
        Math,
        Number,
        String,
        Object,
        Map,
        Set,
        Infinity
    });
    vm.runInContext(src, context);

    const largeLine = Array.from({ length: 100000 }, (_, i) => [42 + i * 0.00001, -8 - i * 0.00001]);
    const bounds = context.communityTrackBounds([largeLine]);
    assert.equal(bounds.minLat, 42);
    assert.ok(bounds.maxLat > 42.9);
    assert.equal(bounds.maxLng, -8);

    const emptyBounds = context.communityTrackBounds([]);
    assert.equal(emptyBounds.minLat, Infinity);
});

test('cloudApi rejects empty server URL and preserves caller AbortError', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud-api.js'), 'utf8');
    const context = vm.createContext({
        Cloud: { server: '', async getSessionToken() { return ''; } },
        APP_CONFIG: { allowLocalHttpServer: false },
        URL,
        Error,
        Promise,
        Object,
        JSON,
        FormData: class {},
        AbortController,
        setTimeout,
        clearTimeout,
        fetch: () => new Promise((_, reject) => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
        })
    });
    vm.runInContext(src, context);

    await assert.rejects(() => context.cloudApi('/api/test'), /No hay ningún servidor configurado/);

    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
        () => context.cloudApi('/api/test', 'GET', null, { server: 'https://example.com', signal: ac.signal }),
        err => err.name === 'AbortError' && err.retryable === false
    );
});

test('BLE parseCsc and parsePower handle truncated DataViews without throwing RangeError', () => {
    const bleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ble.js'), 'utf8')
        .replace(/^import .*$/m, 'const BleClient = {};')
        .replace('window.MtbBle =', 'globalThis.MtbBle =');
    const context = vm.createContext({
        window: {},
        globalThis: {},
        Map,
        Set,
        Number,
        Promise
    });
    vm.runInContext(`${bleSource}\nglobalThis._testBle = { parseCsc, parsePower };`, context);
    const { parseCsc, parsePower } = context.globalThis._testBle;

    const emptyView = new DataView(new ArrayBuffer(0));
    assert.equal(Object.keys(parseCsc(emptyView)).length, 0);
    assert.equal(parsePower(emptyView), null);

    // Flags=0x03 (both wheel and crank) but only 2 bytes long
    const shortView = new DataView(new Uint8Array([0x03, 0x01]).buffer);
    assert.equal(Object.keys(parseCsc(shortView)).length, 0);

    const validPower = new DataView(new Uint8Array([0x00, 0x00, 0xFA, 0x00]).buffer);
    assert.equal(parsePower(validPower), 250);
});
