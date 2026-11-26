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

const gpsSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'gps.js'), 'utf8');
const recordingSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'recording.js'), 'utf8');

function recordingFinishContext({
    activityType = 'mtb',
    failingEffect,
    failDatabasePut = false,
    failSafetyCleanup = false
} = {}) {
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
        recordingActivityType: activityType,
        elev: { gain: 10 },
        getRouteNickname: () => 'Rider',
        followedRoute: null,
        recordingPois: [],
        routeActivityPrefix: type => ({
            mtb: '🚵 MTB · ',
            hiking: '🥾 Senderismo · ',
            road: '🚴 Carretera · ',
            horse: '🐎 Caballo · ',
            running: '🏃 Correr · '
        })[type] || '',
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

function appExitPreparationContext({
    recording = true,
    paused = false,
    saveResult = true,
    liveLocationResult = true,
    stopError
} = {}) {
    const calls = [];
    const context = vm.createContext({
        appExitInProgress: false,
        isRecording: recording,
        isPaused: paused,
        autoPaused: false,
        segStart: 1000,
        movingMs: 2000,
        resetAutoPauseState() { calls.push('resetAutoPauseState'); },
        stopTimers() { calls.push('stopTimers'); },
        stopRideAdvisories() { calls.push('stopRideAdvisories'); },
        setBtnState(state) { calls.push(['setBtnState', state]); },
        $: () => ({ textContent: '' }),
        async releaseWake() { calls.push('releaseWake'); },
        async saveDraft() {
            calls.push('saveDraft');
            return saveResult;
        },
        async removeMyLiveLocation(options) {
            calls.push(['removeMyLiveLocation', options.waitForPendingPush]);
            return liveLocationResult;
        },
        stopGpsForAppExit() { calls.push('stopGpsForAppExit'); },
        async stopBgWatcher(options) {
            calls.push(['stopBgWatcher', options.resumeForegroundGps, options.throwOnError]);
            if (stopError) throw stopError;
        },
        console: { warn() {} }
    });
    const start = recordingSource.indexOf('async function prepareAppExit() {');
    const end = recordingSource.indexOf('\n// Empieza a recibir posiciones', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(
        `${recordingSource.slice(start, end)}\nglobalThis.prepareAppExit = prepareAppExit;`,
        context
    );
    context.cancelAppExitPreparation = () => { context.appExitInProgress = false; };
    return { context, calls };
}

function bgWatcherContext(backgroundGeolocation) {
    const calls = [];
    const context = vm.createContext({
        appExitInProgress: false,
        bgWatcherId: null,
        bgToken: 0,
        bgDeniedShown: false,
        bgStarting: false,
        bgStartPromise: null,
        bgStartPromises: new Set(),
        bgActive: false,
        bgWatcherRemovals: new Set(),
        bgWatcherCleanupIds: new Set(),
        window: {
            Capacitor: {
                isNativePlatform: () => true,
                Plugins: { BackgroundGeolocation: backgroundGeolocation }
            }
        },
        document: { visibilityState: 'hidden' },
        MAX_ACC_M: 30,
        async ensureNotifPermission() {},
        clearGpsWatch() {},
        onPos() {},
        startGps() {},
        console: { warn() {} }
    });
    const pluginStart = recordingSource.indexOf('function bgPlugin() {');
    const pluginEnd = recordingSource.indexOf('\nfunction removeBgWatcher', pluginStart);
    const removalStart = recordingSource.indexOf('function removeBgWatcher(bg, id) {');
    const removalEnd = recordingSource.indexOf('\nasync function ensureNotifPermission', removalStart);
    const start = recordingSource.indexOf('async function startBgWatcher() {');
    const stop = recordingSource.indexOf('\nasync function stopBgWatcher(', start);
    const stopEnd = recordingSource.indexOf('\nasync function prepareAppExit()', stop);
    assert.notEqual(pluginStart, -1);
    assert.notEqual(pluginEnd, -1);
    assert.notEqual(removalStart, -1);
    assert.notEqual(removalEnd, -1);
    assert.notEqual(start, -1);
    assert.notEqual(stop, -1);
    assert.notEqual(stopEnd, -1);
    vm.runInContext([
        recordingSource.slice(pluginStart, pluginEnd),
        recordingSource.slice(removalStart, removalEnd),
        recordingSource.slice(start, stop),
        recordingSource.slice(stop + 1, stopEnd),
        'globalThis.startBgWatcher = startBgWatcher; globalThis.stopBgWatcher = stopBgWatcher;'
    ].join('\n'), context);
    return { context, calls };
}

test('preparing app exit pauses and saves a recording before stopping both GPS watchers', async () => {
    const { context, calls } = appExitPreparationContext();

    await context.prepareAppExit();

    assert.equal(context.isPaused, true);
    assert.equal(context.segStart, null);
    assert.ok(context.movingMs >= 2000);
    assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), [
        'stopGpsForAppExit',
        'resetAutoPauseState',
        'stopTimers',
        'stopRideAdvisories',
        'setBtnState',
        'releaseWake',
        'removeMyLiveLocation',
        'saveDraft',
        'stopBgWatcher'
    ]);
    assert.deepEqual(calls[4], ['setBtnState', 'paused']);
    assert.deepEqual(calls[6], ['removeMyLiveLocation', true]);
    assert.deepEqual(calls[8], ['stopBgWatcher', false, true]);
    assert.equal(context.appExitInProgress, true);
});

test('app exit does not stop GPS or close with an unsaved recording draft', async () => {
    const { context, calls } = appExitPreparationContext({ saveResult: false });

    await assert.rejects(context.prepareAppExit(), /borrador/);

    assert.ok(calls.includes('saveDraft'));
    assert.ok(calls.includes('stopGpsForAppExit'));
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'stopBgWatcher'), false);
    assert.equal(context.appExitInProgress, false);
});

test('a live-location removal failure saves the draft but keeps the app open', async () => {
    const { context, calls } = appExitPreparationContext({ liveLocationResult: false });

    await assert.rejects(context.prepareAppExit(), /ubicación en directo/);

    assert.ok(calls.includes('saveDraft'));
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'stopBgWatcher'), false);
    assert.equal(context.appExitInProgress, false);
});

test('app exit stops stale GPS services even when no recording is active', async () => {
    const { context, calls } = appExitPreparationContext({ recording: false });

    await context.prepareAppExit();

    assert.equal(calls.includes('saveDraft'), false);
    assert.deepEqual(calls, [
        'stopGpsForAppExit',
        ['stopBgWatcher', false, true]
    ]);
});

test('a failed background shutdown releases the exit gate', async () => {
    const { context } = appExitPreparationContext({ stopError: new Error('native removal failed') });

    await assert.rejects(context.prepareAppExit(), /native removal failed/);

    assert.equal(context.appExitInProgress, false);
});

test('recording cannot start or resume while app exit is in progress', async () => {
    const context = vm.createContext({
        appExitInProgress: true,
        isRecording: false,
        isPaused: true
    });
    const beginStart = recordingSource.indexOf('async function beginTracking(showToast) {');
    const beginEnd = recordingSource.indexOf('\nfunction elapsedSec()', beginStart);
    const startStart = recordingSource.indexOf('function startRecording(activityType) {');
    const startEnd = recordingSource.indexOf('\nfunction pauseRecording(', startStart);
    const resumeStart = recordingSource.indexOf('function resumeRecording(', startEnd);
    const resumeEnd = recordingSource.indexOf('\n// Grabar una ruta exige', resumeStart);
    assert.notEqual(beginStart, -1);
    assert.notEqual(beginEnd, -1);
    assert.notEqual(startStart, -1);
    assert.notEqual(startEnd, -1);
    assert.notEqual(resumeStart, -1);
    assert.notEqual(resumeEnd, -1);
    vm.runInContext([
        recordingSource.slice(beginStart, beginEnd),
        recordingSource.slice(startStart, startEnd),
        recordingSource.slice(resumeStart, resumeEnd)
    ].join('\n'), context);

    assert.equal(await context.beginTracking(false), false);
    assert.equal(context.startRecording('mtb'), false);
    assert.equal(context.resumeRecording(), false);
    assert.equal(context.isRecording, false);
    assert.equal(context.isPaused, true);
});

test('failed background watcher removal prevents app exit and retains its ID for retry', async () => {
    const { context } = bgWatcherContext({
        removeWatcher: async () => { throw new Error('native removal failed'); }
    });
    vm.runInContext('bgWatcherId = "watcher-1"; bgActive = true;', context);

    await assert.rejects(context.stopBgWatcher({
        resumeForegroundGps: false,
        throwOnError: true
    }), /native removal failed/);

    assert.equal(vm.runInContext('bgWatcherId', context), 'watcher-1');
});

test('background watcher startup is blocked while app exit is in progress', async () => {
    const calls = [];
    const { context } = bgWatcherContext({
        addWatcher() { calls.push('addWatcher'); }
    });
    context.appExitInProgress = true;

    assert.equal(await context.startBgWatcher(), false);
    assert.deepEqual(calls, []);
});

test('resuming waits for a paused watcher removal and retains the ID after a delayed failure', async () => {
    let rejectFirstRemoval;
    let removeAttempts = 0;
    let addAttempts = 0;
    const calls = [];
    const { context } = bgWatcherContext({
        addWatcher() {
            addAttempts++;
            return Promise.resolve('watcher-2');
        },
        removeWatcher({ id }) {
            calls.push(['removeWatcher', id]);
            removeAttempts++;
            if (removeAttempts === 1) {
                return new Promise((resolve, reject) => { rejectFirstRemoval = reject; });
            }
            return Promise.resolve();
        }
    });
    vm.runInContext('bgWatcherId = "watcher-1"; bgActive = true;', context);

    const stopping = context.stopBgWatcher({ resumeForegroundGps: false });
    await new Promise(resolve => setImmediate(resolve));
    const starting = context.startBgWatcher();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls, [['removeWatcher', 'watcher-1']]);
    assert.equal(addAttempts, 0);

    rejectFirstRemoval(new Error('delayed removal failure'));
    assert.equal(await starting, false);
    await stopping;
    assert.equal(vm.runInContext('bgWatcherId', context), 'watcher-1');

    await context.stopBgWatcher({ resumeForegroundGps: false, throwOnError: true });

    assert.deepEqual(calls, [
        ['removeWatcher', 'watcher-1'],
        ['removeWatcher', 'watcher-1']
    ]);
    assert.equal(addAttempts, 0);
    assert.equal(vm.runInContext('bgWatcherId', context), null);
});

test('stopping an active background watcher waits for native removal', async () => {
    let resolveRemoval;
    const calls = [];
    const { context } = bgWatcherContext({
        removeWatcher({ id }) {
            calls.push(['removeWatcher', id]);
            return new Promise(resolve => { resolveRemoval = resolve; });
        }
    });
    vm.runInContext('bgWatcherId = "watcher-1"; bgActive = true;', context);

    let stopped = false;
    const stopping = context.stopBgWatcher({
        resumeForegroundGps: false,
        throwOnError: true
    }).then(() => { stopped = true; });
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls, [['removeWatcher', 'watcher-1']]);
    assert.equal(stopped, false);

    resolveRemoval();
    await stopping;
    assert.equal(stopped, true);
});

test('app exit clears foreground GPS watch and retry timer', () => {
    const calls = [];
    const context = vm.createContext({
        gpsCallbackToken: 0,
        gpsAppExitPrepared: false,
        gpsWatchId: 7,
        gpsRetryTimer: 9,
        navigator: {
            geolocation: {
                clearWatch(id) { calls.push(['clearWatch', id]); }
            }
        },
        clearTimeout(id) { calls.push(['clearTimeout', id]); }
    });
    const start = gpsSource.indexOf('function clearGpsWatch() {');
    const end = gpsSource.indexOf('\nfunction scheduleGpsRetry()', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(
        `${gpsSource.slice(start, end)}\nglobalThis.stopGpsForAppExit = stopGpsForAppExit;`,
        context
    );

    context.stopGpsForAppExit();

    assert.deepEqual(calls, [['clearWatch', 7], ['clearTimeout', 9]]);
    assert.equal(vm.runInContext('gpsWatchId', context), null);
    assert.equal(vm.runInContext('gpsRetryTimer', context), null);
});

test('app exit invalidates pending one-shot GPS callbacks before they can retry', () => {
    const callbacks = {};
    let retryCount = 0;
    const context = vm.createContext({
        gpsCallbackToken: 0,
        gpsAppExitPrepared: false,
        gpsWatchId: null,
        gpsOneShotPending: false,
        gpsRetryTimer: null,
        gpsRetryDelay: 2000,
        gpsPermissionDenied: false,
        gpsPermissionNoticeShown: false,
        bgActive: false,
        navigator: {
            geolocation: {
                getCurrentPosition(success, error) {
                    callbacks.success = success;
                    callbacks.error = error;
                }
            }
        },
        clearTimeout() {},
        setTimeout() { retryCount++; return 1; },
        onPos() {},
        toast() {},
        console: { warn() {} }
    });
    const start = gpsSource.indexOf('function clearGpsWatch() {');
    const end = gpsSource.indexOf('\nfunction startGps(', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(
        `${gpsSource.slice(start, end)}\nglobalThis.requestCurrentGpsFix = requestCurrentGpsFix; globalThis.stopGpsForAppExit = stopGpsForAppExit;`,
        context
    );

    context.requestCurrentGpsFix();
    assert.equal(context.gpsOneShotPending, true);
    context.stopGpsForAppExit();
    callbacks.error({ code: 2 });

    assert.equal(context.gpsOneShotPending, false);
    assert.equal(retryCount, 0);
    assert.equal(context.gpsAppExitPrepared, true);
});

test('stopping during watcher startup waits until the newly added watcher is removed', async () => {
    let resolveAdd;
    let resolveRemoval;
    const calls = [];
    const { context } = bgWatcherContext({
        addWatcher() {
            calls.push('addWatcher');
            return new Promise(resolve => { resolveAdd = resolve; });
        },
        removeWatcher({ id }) {
            calls.push(['removeWatcher', id]);
            return new Promise(resolve => { resolveRemoval = resolve; });
        }
    });

    const starting = context.startBgWatcher();
    await new Promise(resolve => setImmediate(resolve));
    const stopping = context.stopBgWatcher({
        resumeForegroundGps: false,
        throwOnError: true
    });
    resolveAdd('watcher-2');
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls, ['addWatcher', ['removeWatcher', 'watcher-2']]);
    let stopped = false;
    stopping.then(() => { stopped = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, false);

    resolveRemoval();
    assert.equal(await starting, false);
    await stopping;
    assert.equal(stopped, true);
});

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

function recordingWakeContext(nativeKeepAwakeResult = true) {
    const calls = [];
    const context = vm.createContext({
        async screenSetRecordingKeepAwake(enabled) {
            calls.push(['native', enabled]);
            return nativeKeepAwakeResult;
        },
        screenReleaseWakeLock() { calls.push(['releaseWebWakeLock']); },
        async screenEnsureAwake(allowNativeFallback) { calls.push(['ensureAwake', allowNativeFallback]); },
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
    const start = recordingSource.indexOf('const MAP_RECORDING_HOLD_MS = 1000;');
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

function activitySelectionContext(accountReady = true, lastActivityType = null) {
    class Element {
        constructor() {
            this.children = [];
            this.dataset = {};
            this.attributes = {};
            this.listeners = new Map();
            this.open = false;
        }
        addEventListener(type, handler) {
            const handlers = this.listeners.get(type) || [];
            handlers.push(handler);
            this.listeners.set(type, handlers);
        }
        async trigger(type, event = {}) {
            return Promise.all((this.listeners.get(type) || []).map(handler => handler.call(this, event)));
        }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = children; }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        querySelectorAll() { return this.children.filter(child => child.dataset.activityType); }
        contains(element) { return this.children.includes(element); }
        closest(selector) { return selector === 'button[data-activity-type]' && this.dataset.activityType ? this : null; }
        showModal() { this.open = true; }
        close() { this.open = false; }
    }

    const elements = Object.fromEntries([
        'activity-type-options',
        'activity-type-dialog',
        'activity-type-close',
        'activity-type-cancel',
        'activity-type-start',
        'btn-start'
    ].map(id => [id, new Element()]));
    const calls = [];
    const storageCalls = [];
    const context = vm.createContext({
        ACTIVITY_TYPES: {
            mtb: { label: 'MTB', icon: '🚵' },
            hiking: { label: 'Senderismo', icon: '🥾' },
            road: { label: 'Carretera', icon: '🚴' },
            horse: { label: 'Caballo', icon: '🐎' },
            running: { label: 'Correr', icon: '🏃' }
        },
        btnStart: elements['btn-start'],
        bindMapRecordingHold() {},
        ensureRideAccount: async () => {
            calls.push(['ensureRideAccount']);
            return accountReady;
        },
        startRecording: activityType => calls.push(['startRecording', activityType]),
        pauseRecording: () => calls.push(['pauseRecording']),
        resumeRecording: () => calls.push(['resumeRecording']),
        isRecording: false,
        isPaused: false,
        $: id => elements[id],
        document: { createElement: () => new Element() },
        localStorage: {
            getItem(key) {
                storageCalls.push(['getItem', key]);
                return key === 'mtb_pro_last_activity_type' ? lastActivityType : null;
            },
            setItem(key, value) { storageCalls.push(['setItem', key, value]); }
        },
        console: { error() {} }
    });
    const start = recordingSource.indexOf('const LAST_RECORDING_ACTIVITY_TYPE_KEY =');
    const end = recordingSource.indexOf('\nif (typeof btnStop', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext([
        recordingSource.slice(start, end),
        'globalThis.testReadLastRecordingActivityType = readLastRecordingActivityType;',
        'globalThis.testRememberLastRecordingActivityType = rememberLastRecordingActivityType;'
    ].join('\n'), context);
    return { context, elements, calls, storageCalls };
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

test('saved routes keep the selected activity type and matching name prefix', async () => {
    const activities = [
        ['mtb', '🚵 MTB · '],
        ['hiking', '🥾 Senderismo · '],
        ['road', '🚴 Carretera · '],
        ['horse', '🐎 Caballo · '],
        ['running', '🏃 Correr · ']
    ];

    for (const [activityType, prefix] of activities) {
        const { context, calls, savedRoutes } = recordingFinishContext({ activityType });
        await context.finishRecording();

        const persistedRoute = calls.find(([name]) => name === 'put')[1];
        assert.equal(persistedRoute.activityType, activityType);
        assert.equal(persistedRoute.name, `${prefix}Test route`);
        assert.equal(savedRoutes[0].activityType, activityType);
    }
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

test('recording falls back to the web wake lock when native screen-on fails', async () => {
    const { context, calls } = recordingWakeContext(false);

    await context.acquireWake();

    assert.deepEqual(calls, [
        ['native', true],
        ['ensureAwake', true]
    ]);
});

test('map recording tap is canceled before the one-second hold completes', () => {
    const { button, timers, activations } = recordingHoldContext();
    button.dispatch('pointerdown', { pointerId: 7 });

    assert.deepEqual([...timers.values()].map(timer => timer.delay), [1000]);
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
    assert.equal(timer.delay, 1000);

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
    const [timerId, timer] = [...timers.entries()].find(([, value]) => value.delay === 1000);
    timers.delete(timerId);
    timer.callback();
    button.dispatch('keyup', { key: 'Enter' });
    const keyboardClick = button.dispatch('click', { detail: 0 });

    assert.equal(activations.count, 2);
    assert.equal(keyboardClick.defaultPrevented, true);
});

test('activity choice shows the supported types and starts only the confirmed selection', async () => {
    const { elements, calls } = activitySelectionContext();
    const options = elements['activity-type-options'];
    const dialog = elements['activity-type-dialog'];

    await elements['btn-start'].trigger('click');

    assert.equal(dialog.open, true);
    assert.deepEqual(options.children.map(option => option.dataset.activityType), ['mtb', 'hiking', 'road', 'horse', 'running']);
    const mountainBike = options.children[0];
    assert.equal(mountainBike.attributes['aria-pressed'], 'true');
    assert.deepEqual(calls, []);

    const road = options.children.find(option => option.dataset.activityType === 'road');
    await options.trigger('click', { target: road });
    assert.equal(road.attributes['aria-pressed'], 'true');
    assert.equal(mountainBike.attributes['aria-pressed'], 'false');
    assert.deepEqual(calls, []);

    await elements['activity-type-start'].trigger('click');

    assert.equal(dialog.open, false);
    assert.deepEqual(calls, [['ensureRideAccount'], ['startRecording', 'road']]);
});

test('canceling activity choice does not start or authenticate', async () => {
    const { elements, calls } = activitySelectionContext();
    const dialog = elements['activity-type-dialog'];

    await elements['btn-start'].trigger('click');
    await elements['activity-type-cancel'].trigger('click');

    assert.equal(dialog.open, false);
    assert.deepEqual(calls, []);
});

test('activity choice still requires a ride account before recording', async () => {
    const { elements, calls } = activitySelectionContext(false);
    const dialog = elements['activity-type-dialog'];

    await elements['btn-start'].trigger('click');
    await elements['activity-type-start'].trigger('click');

    assert.equal(dialog.open, false);
    assert.deepEqual(calls, [['ensureRideAccount']]);
});

test('activity chooser defaults to the last saved activity and falls back for unknown values', async () => {
    const { elements, storageCalls } = activitySelectionContext(true, 'horse');

    await elements['btn-start'].trigger('click');

    const horse = elements['activity-type-options'].children.find(option => option.dataset.activityType === 'horse');
    assert.equal(horse.attributes['aria-pressed'], 'true');
    assert.deepEqual(storageCalls, [['getItem', 'mtb_pro_last_activity_type']]);

    const unknown = activitySelectionContext(true, 'unsupported');
    await unknown.elements['btn-start'].trigger('click');
    const mountainBike = unknown.elements['activity-type-options'].children[0];
    assert.equal(mountainBike.attributes['aria-pressed'], 'true');
});

test('last activity preference only stores supported activity types', () => {
    const { context, storageCalls } = activitySelectionContext();

    context.testRememberLastRecordingActivityType('running');
    context.testRememberLastRecordingActivityType('unsupported');

    assert.deepEqual(storageCalls, [['setItem', 'mtb_pro_last_activity_type', 'running']]);
});

test('starting a route remembers its normalized activity type', () => {
    const calls = [];
    const context = vm.createContext({
        appExitInProgress: false,
        unlockOffRouteSound() {},
        navigator: { vibrate: null },
        localStorage: { getItem: () => '0' },
        resetRecordingState() {},
        batteryWarnings: { clear() {} },
        batteryPollAt: 0,
        $: () => ({ textContent: '' }),
        ACTIVITY_TYPES: { mtb: {}, horse: {} },
        recordingActivityType: 'mtb',
        isRecording: false,
        isPaused: true,
        rememberLastRecordingActivityType: activityType => calls.push(['remember', activityType]),
        refreshGpsMode() {},
        clearRoutePolylines() {},
        clearLastRideMapPreview() {},
        setBtnState() {},
        startTimers() {},
        startAutoPauseMonitor() {},
        startRideAdvisories() {},
        following: false,
        updateCenterBtn() {},
        publishMyLocation() {},
        beginTracking() { calls.push(['tracking']); }
    });
    const start = recordingSource.indexOf('function startRecording(activityType) {');
    const end = recordingSource.indexOf('\nfunction pauseRecording(', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(recordingSource.slice(start, end), context);

    context.startRecording('horse');

    assert.equal(context.recordingActivityType, 'horse');
    assert.deepEqual(calls, [['remember', 'horse'], ['tracking']]);
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
