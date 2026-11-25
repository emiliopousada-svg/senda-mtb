const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
    bearingBetween,
    isUsableAltitude,
    gpsSpeedFromFix,
    resetGpsSpeedFix,
    GPS_ACTIVE_OPTIONS,
    GPS_FOLLOW_OPTIONS,
    GPS_LOW_POWER_OPTIONS,
    GPS_MAX_ACC_M,
    GPS_MIN_STEP_M,
    GPS_MAX_SPEED_MS
} = require('../app/gps.js');

const {
    buildSegments,
    autoPauseMovementThreshold,
    autoResumeMovementThreshold,
    isDraftRecoverable,
    rideAccountRequirement
} = require('../app/recording.js');

const recordingSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'recording.js'), 'utf8');

function recordingFinishContext({ failingEffect, failDatabasePut = false, failSafetyCleanup = false } = {}) {
    const calls = [];
    const savedRoutes = [];
    const context = vm.createContext({
        DB: {
            async put(route) {
                calls.push(['put', route]);
                if (failDatabasePut) throw new Error('storage full');
            },
            async kvDel() { calls.push(['clearDraft']); }
        },
        points: [
            [42.1, -8.6, 100, 1000, 120, null],
            [42.2, -8.7, 105, 2000, 122, null]
        ],
        totalDistance: 1,
        routeNameWithoutActivity: route => route.name,
        fmtDate: () => '2026-11-24',
        promptRequiredRouteName: async () => 'Test route',
        routePhotoProcessing: null,
        movingMs: 1000,
        segStart: null,
        startedAt: '2026-11-24T10:00:00Z',
        isRecording: true,
        isPaused: false,
        recordingActivityType: 'mtb',
        elev: { gain: 10 },
        getRouteNickname: () => 'Rider',
        followedRoute: null,
        recordingPois: [],
        routeActivityPrefix: () => '',
        fmtDur: () => '1 min',
        savedRoutes,
        toast: message => calls.push(['toast', message]),
        console: { warn: (...args) => calls.push(['warn', ...args]) },
        navigator: { vibrate: null },
        localStorage: { getItem: () => '0' },
        communityScheduleAutomaticSegmentEffortScan() {},
        garageRouteSaved: () => true,
        renderSavedRoutes() {
            calls.push(['renderSavedRoutes']);
            if (failingEffect === 'renderSavedRoutes') throw new Error('render failed');
        },
        refreshStats() {
            calls.push(['refreshStats']);
            if (failingEffect === 'refreshStats') throw new Error('stats failed');
        },
        syncRoutes() {
            calls.push(['syncRoutes']);
            if (failingEffect === 'syncRoutes') return Promise.reject(new Error('sync failed'));
        },
        safetyOnRecordingStopped: async () => {
            calls.push(['safetyStopped']);
            if (failSafetyCleanup) throw new Error('safety cleanup failed');
        },
        safetyRender: () => calls.push(['safetyRender']),
        refreshGpsMode: () => calls.push(['refreshGpsMode']),
        resetAutoPauseState: () => calls.push(['resetAutoPauseState']),
        stopTimers: () => calls.push(['stopTimers']),
        stopRideAdvisories: () => calls.push(['stopRideAdvisories']),
        releaseWake: () => calls.push(['releaseWake']),
        stopBgWatcher: () => calls.push(['stopBgWatcher']),
        removeMyLiveLocation: () => calls.push(['removeLiveLocation']),
        setBtnState: state => calls.push(['button', state]),
        $: () => ({ textContent: '' }),
        clearDraft: async () => calls.push(['clearDraft']),
        saveDraft: () => calls.push(['saveDraft']),
        download: async () => {},
        routeToGpx: () => ''
    });
    const start = recordingSource.indexOf('async function finishRecording() {');
    const end = recordingSource.indexOf('\n// --- Borrador:', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(recordingSource.slice(start, end), context);
    return { context, calls, savedRoutes };
}

function draftRestoreContext(draft, chunks = []) {
    const calls = [];
    const context = vm.createContext({
        DRAFT_POINTS_CHUNK_SIZE: 500,
        DB: {
            async kvGet(key) {
                calls.push(['get', key]);
                return draft;
            },
            async kvGetDraftPointChunks() { return chunks; }
        },
        async clearDraft() { calls.push(['delete', 'draft']); },
        async modal() {
            calls.push(['modal']);
            return true;
        }
    });
    const start = recordingSource.indexOf('function isDraftRecoverable(d) {');
    const end = recordingSource.indexOf('\nif (typeof document', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(
        `${recordingSource.slice(start, end)}\nglobalThis.maybeRestoreDraft = maybeRestoreDraft; globalThis.hydrateDraft = hydrateDraft;`,
        context
    );
    return { context, calls };
}

function draftSaveContext(initialPoints) {
    const writes = [];
    const context = vm.createContext({
        DRAFT_POINTS_CHUNK_SIZE: 500,
        DB: {
            async kvSaveDraft(draft, chunks) {
                writes.push({ draft, chunks });
            }
        },
        Date,
        clearTimeout() {},
        console: { warn() {} },
        isRecording: true,
        points: initialPoints,
        totalDistance: 1,
        movingMs: 1000,
        segStart: null,
        startedAt: '2026-11-24T10:00:00Z',
        recordingActivityType: 'mtb',
        recordingPois: [],
        draftSaveTimer: null,
        draftSaveMaxWaitTimer: null,
        draftSavePromise: null,
        pendingDraft: null,
        draftStateVersion: 1,
        draftRevision: 0,
        draftSavedRevision: 0,
        draftSavedPointCount: 0
    });
    const start = recordingSource.indexOf('function draftMovingMs() {');
    const end = recordingSource.indexOf('\nasync function clearDraft()', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(
        `${recordingSource.slice(start, end)}\nglobalThis.saveDraft = saveDraft;`,
        context
    );
    return { context, writes };
}

function recordingWakeContext() {
    const calls = [];
    const context = vm.createContext({
        async screenSetRecordingKeepAwake(enabled) {
            calls.push(['native', enabled]);
            return true;
        },
        screenReleaseWakeLock() { calls.push(['releaseWebWakeLock']); },
        async screenEnsureAwake() { calls.push(['ensureAwake']); },
        navigator: {}
    });
    const start = recordingSource.indexOf('async function acquireWake() {');
    const end = recordingSource.indexOf('\n// ---- GPS en segundo plano', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(
        `${recordingSource.slice(start, end)}\nglobalThis.acquireWake = acquireWake; globalThis.releaseWake = releaseWake;`,
        context
    );
    return { context, calls };
}

function recordingHoldContext() {
    const listeners = new Map();
    const classes = new Set();
    const timers = new Map();
    let nextTimerId = 1;
    const button = {
        disabled: false,
        classList: {
            add(name) { classes.add(name); },
            remove(name) { classes.delete(name); },
            contains(name) { return classes.has(name); }
        },
        addEventListener(type, handler, options) {
            const entries = listeners.get(type) || [];
            entries.push({ handler, capture: options === true || Boolean(options && options.capture) });
            listeners.set(type, entries);
        },
        setPointerCapture(pointerId) { this.capturedPointerId = pointerId; },
        dispatch(type, values = {}) {
            const event = {
                type,
                pointerId: 1,
                button: 0,
                clientX: 0,
                clientY: 0,
                key: '',
                repeat: false,
                isPrimary: true,
                detail: 1,
                isTrusted: true,
                defaultPrevented: false,
                immediatePropagationStopped: false,
                preventDefault() { this.defaultPrevented = true; },
                stopImmediatePropagation() { this.immediatePropagationStopped = true; },
                ...values
            };
            const entries = [...(listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture));
            for (const { handler } of entries) {
                handler.call(this, event);
                if (event.immediatePropagationStopped) break;
            }
            return event;
        },
        click() { this.dispatch('click', { detail: 0, isTrusted: false }); }
    };
    const context = vm.createContext({
        window: {
            setTimeout(callback, delay) {
                const id = nextTimerId++;
                timers.set(id, { callback, delay });
                return id;
            },
            clearTimeout(id) { timers.delete(id); }
        }
    });
    const start = recordingSource.indexOf('const MAP_RECORDING_HOLD_MS = 3000;');
    const end = recordingSource.indexOf('\nif (typeof btnStart', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(
        `${recordingSource.slice(start, end)}\nglobalThis.bindMapRecordingHold = bindMapRecordingHold;`,
        context
    );
    context.bindMapRecordingHold(button);
    const activations = { count: 0 };
    button.addEventListener('click', () => { activations.count++; });
    return { button, timers, activations };
}

for (const failingEffect of ['renderSavedRoutes', 'refreshStats', 'syncRoutes']) {
    test(`finishing a saved route still clears recording state if ${failingEffect} fails`, async () => {
        const { context, calls, savedRoutes } = recordingFinishContext({ failingEffect });

        await assert.doesNotReject(context.finishRecording());
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(savedRoutes.length, 1);
        assert.equal(context.isRecording, false);
        assert.equal(context.isPaused, false);
        assert.ok(calls.some(([name]) => name === 'stopBgWatcher'));
        assert.ok(calls.some(([name]) => name === 'clearDraft'));
        assert.ok(calls.some(([name, value]) => name === 'button' && value === 'idle'));
        assert.ok(calls.some(([name]) => name === 'warn'));
    });
}

test('a cleanup error does not prevent clearing the draft after saving', async () => {
    const { context, calls } = recordingFinishContext({ failSafetyCleanup: true });

    await assert.doesNotReject(context.finishRecording());

    assert.equal(context.isRecording, false);
    assert.equal(context.isPaused, false);
    assert.ok(calls.some(([name]) => name === 'clearDraft'));
    assert.ok(calls.some(([name, value]) => name === 'button' && value === 'idle'));
    assert.ok(calls.some(([name]) => name === 'warn'));
});

test('a storage failure preserves the paused recording and draft for retry', async () => {
    const { context, calls, savedRoutes } = recordingFinishContext({ failDatabasePut: true });

    await assert.doesNotReject(context.finishRecording());

    assert.equal(savedRoutes.length, 0);
    assert.equal(context.isRecording, true);
    assert.equal(context.isPaused, true);
    assert.ok(calls.some(([name]) => name === 'saveDraft'));
    assert.equal(calls.some(([name]) => name === 'clearDraft'), false);
});

test('isDraftRecoverable validates raw draft objects before user recovery prompt', () => {
    assert.equal(isDraftRecoverable(null), false);
    assert.equal(isDraftRecoverable(undefined), false);
    assert.equal(isDraftRecoverable({}), false);
    assert.equal(isDraftRecoverable({ points: [] }), false);
    assert.equal(isDraftRecoverable({ points: 'not an array' }), false);
    assert.equal(isDraftRecoverable({ points: [[NaN, -8.6]] }), false);
    assert.equal(isDraftRecoverable({ points: [[42.1, null]] }), false);
    for (const totalDistance of ['12.5', 'corrupt', {}, -1, NaN, Infinity]) {
        assert.equal(isDraftRecoverable({
            totalDistance,
            points: [[42.1, -8.6]]
        }), false);
    }
    assert.equal(isDraftRecoverable({ points: [[42.1, -8.6]] }), true);
    assert.equal(isDraftRecoverable({ totalDistance: null, points: [[42.1, -8.6]] }), true);

    assert.equal(isDraftRecoverable({
        startedAt: '2026-11-16T10:00:00Z',
        totalDistance: 12.5,
        points: [
            [42.235, -8.725, 120, 1700000000000, 145, null],
            [42.236, -8.726, 125, 1700000005000, 148, null]
        ]
    }), true);
});

test('a draft with corrupt distance is discarded before prompting or restoring', async () => {
    const { context, calls } = draftRestoreContext({
        totalDistance: 'corrupt',
        points: [[42.1, -8.6]]
    });

    await assert.doesNotReject(context.maybeRestoreDraft());

    assert.deepEqual(calls, [['get', 'draft'], ['delete', 'draft']]);
});

test('draft autosaves persist only new point chunks and small metadata', async () => {
    const points = Array.from({ length: 600 }, (_, index) => [42, -8, null, index, null]);
    const { context, writes } = draftSaveContext(points);

    await context.saveDraft();
    assert.equal(writes[0].draft.format, 2);
    assert.equal('points' in writes[0].draft, false);
    assert.deepEqual(Array.from(writes[0].chunks, chunk => chunk.points.length), [500, 100]);

    context.points.push([42, -8, null, 600, null], [42, -8, null, 601, null]);
    context.draftStateVersion++;
    await context.saveDraft();
    assert.deepEqual(
        Array.from(writes[1].chunks, chunk => [chunk.index, chunk.points.length]),
        [[1, 102]]
    );

    context.movingMs += 1000;
    await context.saveDraft();
    assert.equal(writes[2].chunks.length, 0);
});

test('chunked draft hydration validates and combines contiguous point chunks', async () => {
    const { context } = draftRestoreContext({
        format: 2,
        pointCount: 3,
        pointChunkCount: 1,
        totalDistance: 0.1
    }, [{
        index: 0,
        points: [[42, -8], [42.1, -8.1], [42.2, -8.2]]
    }]);

    const draft = await context.hydrateDraft({
        format: 2,
        pointCount: 3,
        pointChunkCount: 1,
        totalDistance: 0.1
    });
    assert.equal(draft.points.length, 3);

    const corrupt = await context.hydrateDraft({
        format: 2,
        pointCount: 3,
        pointChunkCount: 2,
        totalDistance: 0.1
    });
    assert.equal(corrupt, null);
});

test('recording acquires native screen-on state and releases it on pause or finish', async () => {
    const { context, calls } = recordingWakeContext();

    await context.acquireWake();
    await context.releaseWake();

    assert.deepEqual(calls, [
        ['native', true],
        ['native', false],
        ['releaseWebWakeLock']
    ]);
});

test('map recording tap is canceled before the three-second hold completes', () => {
    const { button, timers, activations } = recordingHoldContext();
    button.dispatch('pointerdown', { pointerId: 7 });

    assert.deepEqual([...timers.values()].map(timer => timer.delay), [3000]);
    button.dispatch('pointerup', { pointerId: 7 });
    const click = button.dispatch('click', { detail: 1 });

    assert.equal(timers.size, 0);
    assert.equal(activations.count, 0);
    assert.equal(click.defaultPrevented, true);
});

test('map recording hold cancels when the pointer moves away from the button', () => {
    const { button, timers, activations } = recordingHoldContext();
    button.dispatch('pointerdown', { pointerId: 5, clientX: 10, clientY: 10 });
    button.dispatch('pointermove', { pointerId: 5, clientX: 23, clientY: 10 });

    assert.equal(timers.size, 0);
    assert.equal(activations.count, 0);
});

test('map recording action activates once after a full hold and ignores pointer release click', () => {
    const { button, timers, activations } = recordingHoldContext();
    button.dispatch('pointerdown', { pointerId: 3 });
    const [timerId, timer] = [...timers.entries()][0];
    assert.equal(timer.delay, 3000);

    timers.delete(timerId);
    timer.callback();
    button.dispatch('pointerup', { pointerId: 3 });
    const click = button.dispatch('click', { detail: 1 });

    assert.equal(activations.count, 1);
    assert.equal(click.defaultPrevented, true);
});

test('map recording hold supports keyboard input and leaves programmatic clicks available', () => {
    const { button, timers, activations } = recordingHoldContext();
    button.click();
    assert.equal(activations.count, 1);

    const keydown = button.dispatch('keydown', { key: 'Enter' });
    assert.equal(keydown.defaultPrevented, true);
    const [timerId, timer] = [...timers.entries()].find(([, value]) => value.delay === 3000);
    timers.delete(timerId);
    timer.callback();
    button.dispatch('keyup', { key: 'Enter' });
    const keyboardClick = button.dispatch('click', { detail: 0 });

    assert.equal(activations.count, 2);
    assert.equal(keyboardClick.defaultPrevented, true);
});

test('buildSegments splits multi-segment tracks on pause breaks without cross-gap connection', () => {
    // Un track continuo sin breaks genera un único segmento
    const continuousPoints = [
        [42.100, -8.600, 100, 1000, 120, null],
        [42.101, -8.601, 105, 2000, 122, null],
        [42.102, -8.602, 110, 3000, 125, null]
    ];
    const singleSegment = buildSegments(continuousPoints);
    assert.equal(singleSegment.length, 1);
    assert.equal(singleSegment[0].length, 3);
    assert.deepEqual(singleSegment[0][0], [42.100, -8.600]);

    // Un track con pausa (point[5] === 1) divide en dos segmentos separados
    const brokenPoints = [
        [42.100, -8.600, 100, 1000, 120, null],
        [42.101, -8.601, 105, 2000, 122, null],
        [42.150, -8.650, 150, 50000, 110, 1], // reanudación tras pausa
        [42.151, -8.651, 152, 52000, 115, null]
    ];
    const twoSegments = buildSegments(brokenPoints);
    assert.equal(twoSegments.length, 2);
    assert.equal(twoSegments[0].length, 2);
    assert.equal(twoSegments[1].length, 2);
    assert.deepEqual(twoSegments[0][1], [42.101, -8.601]);
    assert.deepEqual(twoSegments[1][0], [42.150, -8.650]);
});

test('GPS route rendering catches up in bounded foreground batches without bridging pause breaks', () => {
    const gpsSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'gps.js'), 'utf8');
    const points = Array.from({ length: 1001 }, (_, index) => [
        42 + index * 0.00001, -8, null, index, null, index === 501 ? 1 : null
    ]);
    const frames = [];
    const timeouts = [];
    const context = vm.createContext({
        points,
        routeRenderedPointCount: 0,
        routePolyline: null,
        routePolylines: [],
        routePolylinePointCount: 0,
        routePolylinePoints: [],
        routePolylineLastPoint: null,
        MAX_ROUTE_RENDER_POINTS: 250,
        document: { visibilityState: 'hidden', addEventListener() {} },
        map: { layers: [] },
        L: {
            polyline(latlngs) {
                return {
                    latlngs: latlngs.slice(),
                    setLatLngs(next) { this.latlngs = next.slice(); },
                    addTo(target) { target.layers.push(this); return this; }
                };
            }
        },
        requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
        cancelAnimationFrame() {},
        setTimeout(callback) { timeouts.push(callback); return timeouts.length; },
        clearTimeout() {}
    });
    vm.runInContext(gpsSource, context);

    context.scheduleGpsVisualUpdate({ ll: [42, -8], speedKmh: 0 });
    assert.equal(timeouts.length, 0, 'hidden pages should not schedule visual timers');
    context.renderPendingRoutePoints();
    assert.equal(context.routeRenderedPointCount, 0);
    assert.equal(context.map.layers.length, 0);

    context.document.visibilityState = 'visible';
    context.renderPendingRoutePoints();
    assert.equal(context.routeRenderedPointCount, 1000);
    assert.equal(frames.length, 1, 'remaining points should continue in another frame');
    while (frames.length) frames.shift()();
    assert.equal(context.routeRenderedPointCount, points.length);

    const beforeBreak = [points[500][0], points[500][1]];
    const afterBreak = [points[501][0], points[501][1]];
    assert.equal(context.routePolylines.some(layer =>
        layer.latlngs.some(point => point[0] === beforeBreak[0] && point[1] === beforeBreak[1])
        && layer.latlngs.some(point => point[0] === afterBreak[0] && point[1] === afterBreak[1])
    ), false);
});

test('gpsSpeedFromFix calculates realistic speeds and discards poor fixes', () => {
    resetGpsSpeedFix();

    // Precisión inaceptable (> 30 m)
    assert.equal(gpsSpeedFromFix([42.0, -8.0], 1000, 35), null);
    assert.equal(gpsSpeedFromFix([42.0, -8.0], 1000, -1), null);

    // Primer fix establece el punto de anclaje inicial -> velocidad 0
    assert.equal(gpsSpeedFromFix([42.0, -8.0], 1000, 10), 0);

    // Movimiento realista: 20 metros al norte en 2 segundos (~10 m/s = ~36 km/h)
    // 1 grado latitud ~ 111.139 metros -> 20 m ~ 0.00018 grados
    const speed = gpsSpeedFromFix([42.00018, -8.0], 3000, 8);
    assert.ok(speed > 30 && speed < 40, `Velocidad esperada ~36 km/h, obtenida: ${speed}`);

    // Ruido parado (< 4 metros en 1 segundo): debe dar 0 km/h
    const jitterSpeed = gpsSpeedFromFix([42.00019, -8.0], 4000, 8);
    assert.equal(jitterSpeed, 0);

    // Salto imposible de GPS (> 90 km/h = 25 m/s): 1000 metros en 1 segundo -> da 0 km/h
    const jumpSpeed = gpsSpeedFromFix([42.01000, -8.0], 5000, 8);
    assert.equal(jumpSpeed, 0);

    // El salto rechazado se convierte en nueva referencia para que no contamine el siguiente cálculo.
    const speedAfterJump = gpsSpeedFromFix([42.01009, -8.0], 7000, 8);
    assert.ok(speedAfterJump > 15 && speedAfterJump < 25,
        `Velocidad tras reiniciar la referencia debe rondar 20 km/h, obtenida: ${speedAfterJump}`);
});

test('isUsableAltitude filters invalid barometric or vertical GPS noise', () => {
    // Altitud imposible en la Tierra
    assert.equal(isUsableAltitude({ altitude: 10000, altitudeAccuracy: 5 }, null, 1), false);
    assert.equal(isUsableAltitude({ altitude: -600, altitudeAccuracy: 5 }, null, 1), false);
    assert.equal(isUsableAltitude({ altitude: NaN, altitudeAccuracy: 5 }, null, 1), false);

    // Precisión vertical deficiente (> 15 m)
    assert.equal(isUsableAltitude({ altitude: 500, altitudeAccuracy: 25 }, null, 1), false);

    // Salto vertical irreal (> 5 m/s de ascenso/descenso)
    const prev = { altitude: 500 };
    assert.equal(isUsableAltitude({ altitude: 550, altitudeAccuracy: 5 }, prev, 2), false); // 25 m/s

    // Lectura válida
    assert.equal(isUsableAltitude({ altitude: 502, altitudeAccuracy: 4 }, prev, 2), true); // 1 m/s
    assert.equal(isUsableAltitude({ altitude: 450, altitudeAccuracy: 6 }, null, 0), true);
});

test('bearingBetween computes accurate compass azimuths', () => {
    // Hacia el Norte exacto: 0°
    const north = bearingBetween([0, 0], [1, 0]);
    assert.equal(Math.round(north), 0);

    // Hacia el Este exacto: 90°
    const east = bearingBetween([0, 0], [0, 1]);
    assert.equal(Math.round(east), 90);

    // Hacia el Sur exacto: 180°
    const south = bearingBetween([1, 0], [0, 0]);
    assert.equal(Math.round(south), 180);

    // Hacia el Oeste exacto: 270°
    const west = bearingBetween([0, 1], [0, 0]);
    assert.equal(Math.round(west), 270);
});

test('auto-pause and auto-resume thresholds adapt safely to GPS accuracy', () => {
    // Con precisión excelente (5 m)
    const pause5 = autoPauseMovementThreshold(5);
    const resume5 = autoResumeMovementThreshold(5);
    assert.ok(pause5 >= 12, 'Umbral mínimo de pausa al menos 12 m');
    assert.ok(resume5 > pause5, 'Reanudación debe requerir más distancia que pausa para evitar oscilaciones');

    // Con precisión moderada (20 m)
    const pause20 = autoPauseMovementThreshold(20);
    const resume20 = autoResumeMovementThreshold(20);
    assert.ok(pause20 <= 30, 'Umbral máximo de pausa acotado a 30 m');
    assert.ok(resume20 <= 35, 'Umbral máximo de reanudación acotado a 35 m');
    assert.ok(resume20 >= pause20);
});

test('GPS tracking options configure high accuracy appropriately', () => {
    assert.equal(GPS_ACTIVE_OPTIONS.enableHighAccuracy, true);
    assert.equal(GPS_ACTIVE_OPTIONS.maximumAge, 0);
    assert.equal(GPS_LOW_POWER_OPTIONS.enableHighAccuracy, false);
    assert.equal(GPS_LOW_POWER_OPTIONS.maximumAge, 10000);
});

test('recording requires a signed-in account with a nickname', () => {
    const cloud = (logged, nickname) => ({ loggedIn: () => logged, nickname });
    assert.equal(rideAccountRequirement(null), 'login');
    assert.equal(rideAccountRequirement(cloud(false, 'Emilio')), 'login');
    assert.equal(rideAccountRequirement(cloud(true, '')), 'nickname');
    assert.equal(rideAccountRequirement(cloud(true, '   ')), 'nickname');
    const privateAccount = cloud(true, 'Emilio');
    assert.equal(privateAccount.groupCode, undefined);
    assert.equal(rideAccountRequirement(privateAccount), null);
});
