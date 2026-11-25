'use strict';

//  CONTROL DE GRABACIÓN
// ============================================================
let wakeLock = null;
let recordingPois = [];
let routePhotoCapturePosition = null;
let routePhotoProcessing = null;
const DRAFT_SAVE_DEBOUNCE_MS = 1500;
const DRAFT_SAVE_MAX_WAIT_MS = 5000;
const DRAFT_POINTS_CHUNK_SIZE = 500;
let draftSaveTimer = null;
let draftSaveMaxWaitTimer = null;
let draftSavePromise = null;
let pendingDraft = null;
let draftStateVersion = 0;
let draftRevision = 0;
let draftSavedRevision = 0;
let draftSavedPointCount = 0;

function clearRoutePolylines() {
    if (typeof resetGpsRouteRenderer === 'function') resetGpsRouteRenderer();
    routePolylines.forEach(polyline => { if (map) map.removeLayer(polyline); });
    routePolylines = [];
    routePolyline = null;
    routePolylinePointCount = 0;
    routePolylinePoints = [];
    routePolylineLastPoint = null;
}

function renderRecordingSegments(routeSegments) {
    clearRoutePolylines();
    if (!map) return;
    routeSegments.forEach(segment => {
        if (!segment.length) return;
        let start = 0;
        while (start < segment.length) {
            const end = Math.min(start + MAX_ROUTE_RENDER_POINTS, segment.length);
            const polyline = L.polyline(segment.slice(start, end), { color: '#ff9800', weight: 5 }).addTo(map);
            routePolylines.push(polyline);
            routePolyline = polyline;
            routePolylinePointCount = end - start;
            routePolylinePoints = segment.slice(start, end);
            routePolylineLastPoint = routePolylinePoints[routePolylinePoints.length - 1];
            if (end === segment.length) break;
            start = end - 1;
        }
    });
    routeRenderedPointCount = points.length;
}

async function acquireWake() {
    if (typeof screenSetRecordingKeepAwake === 'function'
        && await screenSetRecordingKeepAwake(true)) return;
    if (typeof screenEnsureAwake === 'function') {
        await screenEnsureAwake(true);
        return;
    }
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
    } catch (e) {}
}
function releaseWake() {
    let nativeRelease;
    if (typeof screenSetRecordingKeepAwake === 'function') {
        nativeRelease = screenSetRecordingKeepAwake(false);
    }
    if (typeof screenReleaseWakeLock === 'function') screenReleaseWakeLock();
    else if (typeof screenEnsureAwake !== 'function' && wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
    return nativeRelease;
}

// ---- GPS en segundo plano (solo dentro del APK) ----
let bgWatcherId = null, bgToken = 0, bgDeniedShown = false, bgStarting = false;

function bgPlugin() {
    const cap = window.Capacitor;
    if (!(cap && cap.isNativePlatform && cap.isNativePlatform())) return null;
    return (cap.Plugins && cap.Plugins.BackgroundGeolocation) || null;
}

async function ensureNotifPermission() { // Android 13+: para mostrar el aviso "Grabando tu ruta"
    try {
        const cap = window.Capacitor;
        const ln = cap && cap.Plugins && cap.Plugins.LocalNotifications;
        if (!ln) return;
        const st = await ln.checkPermissions();
        if (st.display !== 'granted') await ln.requestPermissions();
    } catch (e) { console.warn('Permiso de notificaciones:', e); }
}

function setMapBattery(battery) {
    const box = $('map-battery');
    if (!battery || !Number.isFinite(battery.level)) { box.hidden = true; return; }
    const pct = Math.max(0, Math.min(100, Math.round(battery.level * 100)));
    box.hidden = false;
    box.classList.toggle('charging', !!battery.charging);
    box.classList.toggle('low', pct <= 20 && !battery.charging);
    box.classList.toggle('mid', pct > 20 && pct <= 40 && !battery.charging);
    $('map-battery-text').textContent = `${pct}%`;
    document.querySelector('#map-battery-icon i').style.width = `${Math.max(8, pct)}%`;
}

let idleBattery = null;
async function pollMapBattery() {
    if (rideBattery || nativeBatteryInfo) { setMapBattery(rideBattery || nativeBatteryInfo); }
    try {
        const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BatteryInfo;
        if (plugin) { setMapBattery(await plugin.getInfo()); return; }
        if (typeof navigator.getBattery === 'function') {
            if (!idleBattery) {
                idleBattery = await navigator.getBattery();
                idleBattery.addEventListener('levelchange', () => setMapBattery(idleBattery));
                idleBattery.addEventListener('chargingchange', () => setMapBattery(idleBattery));
            }
            setMapBattery(idleBattery);
        }
    } catch (e) { console.warn('Batería no disponible:', e); }
}
if (typeof window !== 'undefined') {
    pollMapBattery();
    setInterval(pollMapBattery, 300000);
}

function updateBatteryStatus() {
    const label = $('ride-battery');
    const battery = rideBattery || nativeBatteryInfo;
    setMapBattery(battery);
    if (!battery || !Number.isFinite(battery.level)) {
        label.textContent = '🔋 No disponible';
        return;
    }
    const percentage = Math.round(battery.level * 100);
    label.textContent = `${battery.charging ? '🔌' : '🔋'} ${percentage}%`;
    if (battery.charging) return;

    if (percentage <= 10 && !batteryWarnings.has(10)) {
        batteryWarnings.add(20);
        batteryWarnings.add(10);
        notifyBatteryWarning('Batería crítica: queda un 10% o menos.');
    } else if (percentage <= 20 && !batteryWarnings.has(20)) {
        batteryWarnings.add(20);
        notifyBatteryWarning('Batería baja: queda un 20% o menos.');
    }
}

async function refreshBatteryStatus() {
    if (!isRecording || isPaused) return;
    if (rideBattery) { updateBatteryStatus(); return; }
    const cap = window.Capacitor;
    const plugin = cap && cap.Plugins && cap.Plugins.BatteryInfo;
    if (!plugin || Date.now() - batteryPollAt < 55000) {
        updateBatteryStatus();
        return;
    }
    batteryPollAt = Date.now();
    try {
        nativeBatteryInfo = await plugin.getInfo();
        if (isRecording && !isPaused) updateBatteryStatus();
    } catch (error) {
        console.warn('No se pudo consultar la batería del dispositivo:', error);
        $('ride-battery').textContent = '🔋 No disponible';
    }
}

function notifyBatteryWarning(message) {
    toast(`⚠️ ${message}`, 7000);
    if (document.visibilityState !== 'hidden') return;
    const cap = window.Capacitor;
    const ln = cap && cap.Plugins && cap.Plugins.LocalNotifications;
    if (!ln) return;
    ln.checkPermissions().then(permission => {
        if (permission.display !== 'granted') return;
        return ln.schedule({
            notifications: [{
                id: (Date.now() % 2147483647) + 1,
                title: 'senda-mtb · Batería',
                body: message,
                schedule: { at: new Date(Date.now() + 1000) }
            }]
        });
    }).catch(error => console.warn('No se pudo mostrar el aviso de batería:', error));
}

function startRideAdvisories() {
    const token = ++rideAdvisoryToken;
    batteryPollAt = 0;
    $('ride-status').classList.add('show');
    if (!rideBattery) $('ride-battery').textContent = '🔋 --';
    refreshBatteryStatus();
    const getBattery = navigator.getBattery;
    if (typeof getBattery !== 'function') {
        updateBatteryStatus();
    } else {
        getBattery.call(navigator).then(battery => {
            if (token !== rideAdvisoryToken || !isRecording || isPaused) return;
            if (rideBattery) {
                rideBattery.removeEventListener('levelchange', updateBatteryStatus);
                rideBattery.removeEventListener('chargingchange', updateBatteryStatus);
            }
            rideBattery = battery;
            nativeBatteryInfo = null;
            rideBattery.addEventListener('levelchange', updateBatteryStatus);
            rideBattery.addEventListener('chargingchange', updateBatteryStatus);
            updateBatteryStatus();
        }).catch(error => {
            console.warn('No se pudo consultar la batería del dispositivo:', error);
            $('ride-battery').textContent = '🔋 No disponible';
        });
    }
    batteryCheckInterval = setInterval(refreshBatteryStatus, 60000);
}

function stopRideAdvisories() {
    rideAdvisoryToken++;
    clearInterval(batteryCheckInterval);
    batteryCheckInterval = null;
    if (rideBattery) {
        rideBattery.removeEventListener('levelchange', updateBatteryStatus);
        rideBattery.removeEventListener('chargingchange', updateBatteryStatus);
        rideBattery = null;
    }
    nativeBatteryInfo = null;
    $('ride-status').classList.remove('show');
}

async function onBgDenied(bg) {
    if (bgDeniedShown) return;
    bgDeniedShown = true;
    const ok = await modal({
        message: 'Para grabar con la pantalla bloqueada la app necesita el permiso de ubicación. ¿Abrir los ajustes?',
        ok: 'Abrir ajustes', cancel: 'Ahora no'
    });
    if (ok) bg.openSettings();
    bgDeniedShown = false;
}

function handleBgWatcherError(my, bg, error) {
    if (my !== bgToken) return;
    console.warn('GPS en segundo plano:', error);
    const id = bgWatcherId;
    bgToken++;
    bgStarting = false;
    bgActive = false;
    bgWatcherId = null;
    if (id != null) {
        bg.removeWatcher({ id }).catch(removeError => {
            console.warn('No se pudo detener el watcher GPS en segundo plano:', removeError);
        });
    }
    if (error && error.code === 'NOT_AUTHORIZED') onBgDenied(bg);
    else if (id != null) toast('No se pudo mantener el GPS en segundo plano. Mantén la app abierta para seguir grabando.', 7000);
    if (document.visibilityState === 'visible' && isRecording && !isPaused) startGps();
}

async function startBgWatcher() {
    const bg = bgPlugin();
    if (!bg) return false;
    if (bgActive || bgStarting) return true;
    const my = ++bgToken;
    bgStarting = true;
    try {
        await ensureNotifPermission();
        const id = await bg.addWatcher({
            backgroundTitle: 'senda-mtb',
            backgroundMessage: 'Grabando tu ruta…',
            requestPermissions: true,
            stale: false,
            // A modestly wider filter reduces native location callbacks and GPS work
            // while keeping track spacing close to the existing 4 m recording gate.
            distanceFilter: 6
        }, (loc, err) => {
            if (my !== bgToken) return;
            if (err) {
                handleBgWatcherError(my, bg, err);
                return;
            }
            if (!loc) return;
            const position = {
                coords: {
                    latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
                    altitude: loc.altitude, altitudeAccuracy: loc.altitudeAccuracy,
                    speed: loc.speed, heading: loc.heading ?? loc.bearing
                },
                timestamp: loc.time
            };
            const usableFix = Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)
                && Number.isFinite(loc.accuracy) && loc.accuracy >= 0 && loc.accuracy <= MAX_ACC_M
                && Number.isFinite(loc.time);
            if (usableFix) {
                bgActive = true;
                bgStarting = false;
                clearGpsWatch();
            }
            onPos(position);
        });
        if (my !== bgToken) { // se pausó o terminó mientras se activaba
            try { await bg.removeWatcher({ id }); }
            catch (error) { console.warn('No se pudo detener el watcher GPS en segundo plano:', error); }
            return false;
        }
        if (typeof id !== 'string' || !id) throw new Error('El plugin no devolvió el ID del watcher.');
        bgWatcherId = id;
        if (bgActive) clearGpsWatch();
        return true;
    } catch (e) {
        console.warn('No se pudo iniciar el GPS en segundo plano:', e);
        if (my === bgToken) {
            bgToken++;
            bgWatcherId = null;
            bgStarting = false;
            bgActive = false;
        }
        return false;
    }
}

function stopBgWatcher() {
    const bg = bgPlugin();
    const id = bgWatcherId;
    bgToken++;
    bgActive = false;
    bgStarting = false;
    bgWatcherId = null;
    if (bg && id != null) {
        bg.removeWatcher({ id }).catch(error => {
            console.warn('No se pudo detener el watcher GPS en segundo plano:', error);
        });
    }
    if (document.visibilityState === 'visible') startGps();
}

// Empieza a recibir posiciones: en segundo plano si se puede; si no, pantalla encendida
async function beginTracking(showToast) {
    await acquireWake();
    const ok = await startBgWatcher();
    if (ok) {
        if (showToast) {
            toast(bgActive
                ? 'Grabando en segundo plano: puedes bloquear la pantalla.'
                : 'Activando GPS en segundo plano. Mantén la app abierta hasta recibir una posición precisa.', 5000);
        }
        return;
    }
    if (showToast) {
        toast('wakeLock' in navigator
            ? 'Grabando. Mantén la app abierta en primer plano.'
            : 'Grabando. Tu navegador no mantiene la pantalla encendida: no la bloquees o se perderá el track.', 5000);
    }
}

function elapsedSec() {
    return Math.floor((movingMs + (segStart ? Date.now() - segStart : 0)) / 1000);
}
function totalSec() {
    const start = Date.parse(startedAt);
    return Number.isFinite(start) ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : 0;
}
function updateTimerDisplay() {
    $('m-moving').textContent = fmtClock(elapsedSec());
    $('m-time').textContent = fmtClock(totalSec());
    const movingHours = elapsedSec() / 3600;
    $('m-avg-speed').textContent = movingHours > 0 ? (totalDistance / movingHours).toFixed(1) : '0.0';
}
function startTimers() {
    clearInterval(timerInterval);
    clearInterval(draftInterval);
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 1000);
    draftInterval = setInterval(saveDraft, 30000);
}
// En pausa el tiempo total sigue corriendo; solo se detiene el borrador.
function pauseTimers() {
    clearInterval(draftInterval);
    draftInterval = null;
    updateTimerDisplay();
}
function stopTimers() {
    clearInterval(timerInterval);
    clearInterval(draftInterval);
    timerInterval = draftInterval = null;
}

function setBtnState(s) {
    btnStart.classList.toggle('recording', s !== 'idle');
    lblStart.textContent = { idle: 'Iniciar actividad', recording: 'Pausar actividad', paused: 'Reanudar actividad', 'auto-paused': 'Pausa automática' }[s];
    icoStart.textContent = s === 'recording' ? 'Ⅱ' : '▶';
    $('map-live-title').textContent = ({ idle: 'Lista para grabar', recording: 'Grabación en directo', paused: 'Actividad en pausa', 'auto-paused': 'Pausa automática' })[s];
    $('page-map').dataset.recordingState = s;
    if (typeof mapPanelSyncActions === 'function') mapPanelSyncActions();
    if (s === 'idle') {
        mapPanelSetExpanded(true);
        if (typeof mapSideControlsSetVisible === 'function') mapSideControlsSetVisible(true);
    } else if (s === 'recording') {
        if (typeof mapPanelScheduleAutoCollapse === 'function') mapPanelScheduleAutoCollapse();
        if (typeof mapSideControlsScheduleAutoCollapse === 'function') mapSideControlsScheduleAutoCollapse();
    }
    $('btn-route-photo').hidden = s === 'idle';
}

function autoPauseMovementThreshold(accuracy) {
    return Math.max(12, Math.min(30, accuracy * 1.5));
}

function autoResumeMovementThreshold(accuracy) {
    return Math.max(20, Math.min(35, accuracy * 1.5));
}

function updateAutoPauseMovement(position, accuracy) {
    const now = Date.now();
    if (!autoPauseAnchor) {
        autoPauseAnchor = position;
        autoPauseLastMovementAt = now;
    } else if (dist(autoPauseAnchor, position) >= autoPauseMovementThreshold(accuracy)) {
        autoPauseAnchor = position;
        autoPauseLastMovementAt = now;
    }
    autoPauseLastPosition = position;
}

function updateAutoPauseResume(position, accuracy) {
    const now = Date.now();
    const fromPauseAnchor = autoPauseAnchor ? dist(autoPauseAnchor, position) : 0;
    if (!autoPauseResumeCandidate) {
        if (fromPauseAnchor >= autoResumeMovementThreshold(accuracy)) {
            autoPauseResumeCandidate = { distance: fromPauseAnchor, startedAt: now };
        }
        return;
    }

    const confirmedTravel = Math.max(6, Math.min(10, accuracy * 0.4));
    const confirmed = now - autoPauseResumeCandidate.startedAt >= AUTO_RESUME_CONFIRM_MS &&
        fromPauseAnchor >= autoResumeMovementThreshold(accuracy) &&
        fromPauseAnchor >= autoPauseResumeCandidate.distance + confirmedTravel;
    if (confirmed) {
        resumeRecording(true, position);
    } else if (now - autoPauseResumeCandidate.startedAt >= AUTO_RESUME_CONFIRM_MS * 6) {
        autoPauseResumeCandidate = null;
    }
}

function startAutoPauseMonitor() {
    clearInterval(autoPauseInterval);
    autoPauseInterval = setInterval(() => {
        if (isRecording && !isPaused && autoPauseLastMovementAt !== null
            && Date.now() - autoPauseLastMovementAt >= AUTO_PAUSE_AFTER_MS) {
            pauseRecording(true);
        }
    }, 1000);
}

function stopAutoPauseMonitor() {
    clearInterval(autoPauseInterval);
    autoPauseInterval = null;
}

function resetAutoPauseState() {
    stopAutoPauseMonitor();
    autoPaused = false;
    autoPauseAnchor = null;
    autoPauseLastPosition = null;
    autoPauseLastMovementAt = null;
    autoPauseResumeCandidate = null;
}

function resetRecordingState() {
    resetAutoPauseState();
    points = [];
    draftSavedPointCount = 0;
    totalDistance = 0;
    elev = makeElevTracker();
    lastAccepted = null;
    resumeBreak = false;
    movingMs = 0;
    segStart = null;
    startedAt = null;
    recordingPois = [];
    showRoutePoisOnMap(followedRoute ? followedRoute.pois : []);
}

function addRoutePhoto() {
    if (!isRecording) { toast('Empieza una ruta antes de añadir una foto.'); return; }
    if (recordingPois.length >= ROUTE_POI_MAX_PHOTOS) {
        toast(`Cada ruta puede tener hasta ${ROUTE_POI_MAX_PHOTOS} fotos.`);
        return;
    }
    if (lastLat === null || lastLon === null || !Number.isFinite(lastAccuracy) || lastAccuracy > MAX_ACC_M) {
        toast('Espera a tener una posición GPS precisa antes de añadir la foto.');
        return;
    }
    routePhotoCapturePosition = { lat: lastLat, lng: lastLon };
    const input = $('route-photo-input');
    input.value = '';
    input.click();
}

if (typeof $ === 'function') {
    $('btn-route-photo')?.addEventListener('click', addRoutePhoto);
    $('route-photo-input')?.addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    const position = routePhotoCapturePosition;
    routePhotoCapturePosition = null;
    if (!file || !position) return;
    if (!isRecording) { toast('La ruta ya no está grabándose; no se añadió la foto.'); return; }
    const processing = prepareRoutePoiPhoto(file);
    routePhotoProcessing = processing;
    try {
        const photo = await processing;
        if (!isRecording) { toast('La ruta ya no está grabándose; no se añadió la foto.'); return; }
        if (recordingPois.length >= ROUTE_POI_MAX_PHOTOS) {
            toast(`Cada ruta puede tener hasta ${ROUTE_POI_MAX_PHOTOS} fotos.`);
            return;
        }
        const capturedAt = new Date();
        let savedCopyPath = '';
        let copyFailed = false;
        try {
            savedCopyPath = await saveRoutePhotoToPhone(file, startedAt, capturedAt) || '';
        } catch (error) {
            console.warn('No se pudo guardar una copia de la foto en Documentos:', error);
            copyFailed = true;
        }
        recordingPois.push({
            lat: position.lat,
            lng: position.lng,
            caption: 'Foto de ruta',
            photo,
            createdAt: capturedAt.toISOString(),
            savedCopyPath
        });
        showRoutePoisOnMap([...(followedRoute ? followedRoute.pois : []), ...recordingPois]);
        scheduleDraftSave(0);
        toast(savedCopyPath
            ? 'Foto añadida y guardada en Documentos/MTB Camboya PRO/Rutas.'
            : copyFailed
                ? 'Foto añadida a la ruta, pero no se pudo copiar a Documentos.'
                : 'Foto añadida como punto de interés de la ruta.');
    } catch (error) {
        console.warn('No se pudo añadir la foto a la ruta:', error);
        toast(`No se pudo añadir la foto: ${error.message || 'error al procesarla'}`);
    } finally {
        if (routePhotoProcessing === processing) routePhotoProcessing = null;
        event.target.value = '';
    }
    });
}

function startRecording(activityType) {
    unlockOffRouteSound();
    if (navigator.vibrate && localStorage.getItem('mtb_pro_recording_haptics') !== '0') navigator.vibrate([45, 35, 65]);
    resetRecordingState();
    batteryWarnings.clear();
    batteryPollAt = 0;
    $('ride-battery').textContent = '🔋 --';
    recordingActivityType = Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, activityType) ? activityType : 'mtb';
    isRecording = true;
    isPaused = false;
    refreshGpsMode();
    startedAt = new Date().toISOString();
    segStart = Date.now();
    $('m-dist').textContent = '0.00';
    $('m-elevation').textContent = '0';
    clearRoutePolylines();
    clearLastRideMapPreview();
    setBtnState('recording');
    startTimers();
    startAutoPauseMonitor();
    startRideAdvisories();
    following = true;
    updateCenterBtn();
    if (typeof safetyOnRecordingStarted === 'function') {
        safetyOnRecordingStarted().catch(error => console.error('No se pudo activar la protección de ruta:', error));
    }
    if (typeof safetyRender === 'function') safetyRender();
    if (typeof sensorsReconnectNow === 'function') sensorsReconnectNow();
    publishMyLocation(true);
    beginTracking(true);
}

function pauseRecording(automatic = false) {
    if (!isRecording || isPaused) return;
    const pauseAt = automatic && autoPauseLastMovementAt !== null
        ? autoPauseLastMovementAt
        : Date.now();
    if (segStart !== null) {
        movingMs += Math.max(0, pauseAt - segStart);
        segStart = null;
    }
    isPaused = true;
    autoPaused = automatic;
    refreshGpsMode();
    stopAutoPauseMonitor();
    pauseTimers();
    stopRideAdvisories();
    releaseWake();
    if (!automatic) {
        stopBgWatcher();
    } else if (autoPauseLastPosition) {
        autoPauseAnchor = autoPauseLastPosition;
        autoPauseResumeCandidate = null;
    }
    removeMyLiveLocation();
    setBtnState(automatic ? 'auto-paused' : 'paused');
    if (!automatic && navigator.vibrate && localStorage.getItem('mtb_pro_recording_haptics') !== '0') navigator.vibrate(45);
    $('m-speed').textContent = '0.0';
    scheduleDraftSave(0);
    if (typeof safetyRender === 'function') safetyRender();
    if (automatic) toast(`Pausa automática: sin movimiento durante ${AUTO_PAUSE_AFTER_MS / 1000} segundos.`);
}

function resumeRecording(automatic = false, position = null) {
    unlockOffRouteSound();
    isPaused = false;
    autoPaused = false;
    refreshGpsMode();
    segStart = Date.now();
    resumeBreak = !automatic; // la pausa automática mantiene el track unido; la manual inicia otro tramo
    autoPauseAnchor = position;
    autoPauseLastPosition = position;
    autoPauseLastMovementAt = position ? Date.now() : null;
    autoPauseResumeCandidate = null;
    setBtnState('recording');
    if (!automatic && navigator.vibrate && localStorage.getItem('mtb_pro_recording_haptics') !== '0') navigator.vibrate([40, 30, 55]);
    startTimers();
    startAutoPauseMonitor();
    startRideAdvisories();
    publishMyLocation(true);
    beginTracking(false);
    if (typeof safetyRender === 'function') safetyRender();
    if (automatic) toast('Grabación reanudada automáticamente.');
}

// Grabar una ruta exige una cuenta con sesión iniciada y apodo (perfil completo).
// Devuelve null si se puede grabar, 'login' si falta la sesión o 'nickname' si falta el apodo.
function rideAccountRequirement(cloud) {
    if (!cloud || typeof cloud.loggedIn !== 'function' || !cloud.loggedIn()) return 'login';
    if (!String(cloud.nickname || '').trim()) return 'nickname';
    return null;
}

async function ensureRideAccount() {
    const missing = rideAccountRequirement(typeof Cloud !== 'undefined' ? Cloud : null);
    if (!missing) return true;
    const go = await modal({
        message: missing === 'login'
            ? 'Para grabar una ruta tienes que iniciar sesión o crear tu cuenta en Ajustes.'
            : 'Para grabar una ruta elige primero tu apodo en Ajustes > Cuenta.',
        ok: 'Ir a mi cuenta',
        cancel: 'Ahora no'
    });
    if (go && typeof goToPage === 'function') {
        goToPage(4);
        const field = $(missing === 'login' ? 'acc-email' : 'acc-account-nickname');
        if (field) setTimeout(() => {
            field.scrollIntoView({ block: 'center', behavior: 'smooth' });
            field.focus({ preventScroll: true });
        }, 350);
    }
    return false;
}

const MAP_RECORDING_HOLD_MS = 2000;
const MAP_RECORDING_HOLD_MOVE_THRESHOLD_PX = 12;

function bindMapRecordingHold(button) {
    let holdTimer = null;
    let activePointerId = null;
    let pointerStart = null;
    let activeKeyboardKey = null;
    let suppressKeyboardClick = false;

    const clearHold = () => {
        if (holdTimer !== null) {
            window.clearTimeout(holdTimer);
            holdTimer = null;
        }
        button.classList.remove('is-holding');
    };
    const startHold = () => {
        if (holdTimer !== null) return;
        button.classList.add('is-holding');
        holdTimer = window.setTimeout(() => {
            holdTimer = null;
            button.classList.remove('is-holding');
            button.click();
        }, MAP_RECORDING_HOLD_MS);
    };
    const finishPointer = event => {
        if (activePointerId !== event.pointerId) return;
        activePointerId = null;
        pointerStart = null;
        clearHold();
    };

    button.addEventListener('pointerdown', event => {
        if (event.isPrimary === false || event.button !== 0 || button.disabled || holdTimer !== null) return;
        activePointerId = event.pointerId;
        pointerStart = [event.clientX, event.clientY];
        button.setPointerCapture(event.pointerId);
        startHold();
    });
    button.addEventListener('pointermove', event => {
        if (activePointerId !== event.pointerId || !pointerStart) return;
        const dx = event.clientX - pointerStart[0];
        const dy = event.clientY - pointerStart[1];
        if (dx * dx + dy * dy > MAP_RECORDING_HOLD_MOVE_THRESHOLD_PX ** 2) finishPointer(event);
    });
    button.addEventListener('pointerup', finishPointer);
    button.addEventListener('pointercancel', finishPointer);
    button.addEventListener('lostpointercapture', finishPointer);
    button.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (event.repeat || activeKeyboardKey || holdTimer !== null || button.disabled) return;
        activeKeyboardKey = event.key;
        suppressKeyboardClick = true;
        startHold();
    });
    button.addEventListener('keyup', event => {
        if (activeKeyboardKey !== event.key) return;
        event.preventDefault();
        activeKeyboardKey = null;
        clearHold();
        window.setTimeout(() => { suppressKeyboardClick = false; }, 0);
    });
    button.addEventListener('blur', () => {
        activeKeyboardKey = null;
        activePointerId = null;
        pointerStart = null;
        clearHold();
    });
    button.addEventListener('contextmenu', event => event.preventDefault());
    button.addEventListener('click', event => {
        if (!event.isTrusted || (event.detail === 0 && !suppressKeyboardClick)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
}

let recordingActionPending = false;
if (typeof btnStart !== 'undefined' && btnStart) {
    bindMapRecordingHold(btnStart);
    btnStart.addEventListener('click', async () => {
        if (recordingActionPending) return;
        recordingActionPending = true;
        try {
            if (!isRecording) {
                if (!(await ensureRideAccount())) return;
                startRecording('mtb');
            }
            else if (!isPaused) pauseRecording();
            else resumeRecording();
        } finally {
            recordingActionPending = false;
        }
    });
}

if (typeof btnStop !== 'undefined' && btnStop) {
    bindMapRecordingHold(btnStop);
    btnStop.addEventListener('click', async () => {
        if (recordingActionPending) return;
        recordingActionPending = true;
        try {
            const ok = await modal({ message: '¿Finalizar y guardar esta ruta?', ok: 'Guardar', cancel: 'Seguir grabando' });
            if (ok) await finishRecording();
        } finally {
            recordingActionPending = false;
        }
    });
}

async function finishRecording() {
    const hasRoute = points.length > 1 && totalDistance >= 0.05;
    let routeName = null;
    if (hasRoute) {
        routeName = await promptRequiredRouteName(fmtDate(startedAt));
        if (routeName === null) {
            toast('La ruta no se ha guardado; puedes finalizarla cuando quieras.');
            return;
        }
        if (routePhotoProcessing) await routePhotoProcessing;
    }
    if (segStart) { movingMs += Date.now() - segStart; segStart = null; }
    const sec = Math.round(movingMs / 1000);
    let routeSaved = !hasRoute;
    try {
        if (hasRoute) {
            isPaused = true;
            resetAutoPauseState();
            stopTimers();
            stopRideAdvisories();
            releaseWake();
            stopBgWatcher();
            removeMyLiveLocation();
            setBtnState('paused');
            $('m-speed').textContent = '0.0';
            const hrs = points.map(p => p[4]).filter(h => Number.isFinite(h) && h > 0);
            const route = {
                id: Date.now(),
                kind: 'recorded',
                activityType: recordingActivityType,
                name: `${routeActivityPrefix(recordingActivityType)}${routeName}`,
                createdBy: (typeof getRouteNickname === 'function' && getRouteNickname()) || 'Usuario local',
                startedAt,
                movingTimeSec: sec,
                distanceKm: +totalDistance.toFixed(3),
                elevationGain: Math.round(elev.gain),
                hrAvg: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
                followedImportedRoute: followedRoute && followedRoute.kind === 'imported' ? followedRoute.name : null,
                pois: recordingPois.slice(),
                points
            };
            if (!await saveRoute(route)) {
                saveDraft();
                toast('La ruta sigue en pausa. Libera espacio y vuelve a intentar guardarla; también puedes exportarla como GPX.');
                return;
            }
            routeSaved = true;
            toast(`✅ Ruta guardada: ${route.distanceKm.toFixed(2)} km · ${fmtDur(sec)} · +${route.elevationGain} m`, 5000);
        } else {
            toast('La ruta es muy corta y no se ha guardado.');
        }
    } finally {
        if (routeSaved) {
            const cleanupFailures = [];
            const runCleanup = async (label, action) => {
                try {
                    await action();
                } catch (error) {
                    cleanupFailures.push(label);
                    console.warn(`No se pudo completar ${label} al finalizar la ruta:`, error);
                }
            };
            isRecording = false;
            isPaused = false;
            await runCleanup('detener la protección de grabación', async () => {
                if (typeof safetyOnRecordingStopped === 'function') await safetyOnRecordingStopped();
            });
            await runCleanup('actualizar la protección de grabación', async () => {
                if (typeof safetyRender === 'function') safetyRender();
            });
            await runCleanup('emitir la vibración de finalización', async () => {
                if (navigator.vibrate && localStorage.getItem('mtb_pro_recording_haptics') !== '0') {
                    navigator.vibrate([70, 45, 130]);
                }
            });
            await runCleanup('actualizar el modo GPS', refreshGpsMode);
            await runCleanup('restablecer la pausa automática', resetAutoPauseState);
            await runCleanup('detener los temporizadores', stopTimers);
            await runCleanup('detener los avisos de ruta', stopRideAdvisories);
            await runCleanup('liberar el bloqueo de pantalla', releaseWake);
            await runCleanup('detener el GPS en segundo plano', stopBgWatcher);
            await runCleanup('eliminar la ubicación en directo', removeMyLiveLocation);
            await runCleanup('restablecer el botón de grabación', async () => {
                setBtnState('idle');
                $('m-speed').textContent = '0.0';
            });
            await runCleanup('borrar el borrador', clearDraft);
            if (cleanupFailures.length) {
                try {
                    toast(`La ruta se guardó, pero hubo errores al finalizar: ${cleanupFailures.join(', ')}.`, 6000);
                } catch (error) {
                    console.warn('No se pudo mostrar el aviso de errores al finalizar la ruta:', error);
                }
            }
        }
    }
}

async function saveRoute(r) {
    if (!routeNameWithoutActivity(r).trim()) {
        toast('Escribe un nombre antes de guardar la ruta.');
        return false;
    }
    try {
        await DB.put(r);
    } catch (e) {
        console.warn('Error guardando:', e);
        toast('⚠️ No se pudo guardar la ruta en el dispositivo (¿almacenamiento lleno?). Se intentará exportar como GPX.', 7000);
        try {
            const safe = String(r.name || 'ruta').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_').trim() || 'ruta';
            await download(`${safe}.gpx`, routeToGpx(r), 'application/gpx+xml');
        } catch (exportError) {
            console.warn('No se pudo exportar la ruta como GPX:', exportError);
            toast('No se pudo exportar la ruta. Sigue en pausa mientras la app permanezca abierta.', 7000);
        }
        return false;
    }
    const reportSideEffectError = (description, error) => {
        console.warn(`La ruta se guardó, pero no se pudo ${description}:`, error);
        try {
            toast(`La ruta se guardó, pero no se pudo ${description}.`, 6000);
        } catch (toastError) {
            console.warn('No se pudo mostrar el aviso de error posterior al guardado:', toastError);
        }
    };
    const runSideEffect = (description, action) => {
        try {
            const result = action();
            if (result && typeof result.then === 'function') {
                Promise.resolve(result).catch(error => reportSideEffectError(description, error));
            }
        } catch (error) {
            reportSideEffectError(description, error);
        }
    };
    runSideEffect('actualizar la lista de rutas', () => savedRoutes.unshift(r));
    runSideEffect('programar el análisis de segmentos', () => {
        if (typeof communityScheduleAutomaticSegmentEffortScan === 'function') {
            return communityScheduleAutomaticSegmentEffortScan();
        }
    });
    runSideEffect('actualizar el mantenimiento preventivo', () => {
        if (typeof garageRouteSaved === 'function' && !garageRouteSaved(r)) {
            throw new Error('No se pudo actualizar el mantenimiento preventivo.');
        }
    });
    runSideEffect('mostrar las rutas guardadas', renderSavedRoutes);
    runSideEffect('actualizar las estadísticas', refreshStats);
    runSideEffect('sincronizar con la nube', syncRoutes);
    return true;
}

// --- Borrador: recuperar una ruta si la app se cierra durante la grabación ---
function draftMovingMs() {
    return Math.floor((movingMs + (segStart ? Date.now() - segStart : 0)) / 1000) * 1000;
}

function scheduleDraftSave(delay = DRAFT_SAVE_DEBOUNCE_MS) {
    if (!isRecording) return;
    draftStateVersion++;
    clearTimeout(draftSaveTimer);
    if (delay <= 0) {
        clearTimeout(draftSaveMaxWaitTimer);
        draftSaveMaxWaitTimer = null;
        saveDraft();
        return;
    }
    draftSaveTimer = setTimeout(() => {
        draftSaveTimer = null;
        saveDraft();
    }, delay);
    if (!draftSaveMaxWaitTimer) {
        draftSaveMaxWaitTimer = setTimeout(() => {
            draftSaveMaxWaitTimer = null;
            saveDraft();
        }, DRAFT_SAVE_MAX_WAIT_MS);
    }
}

function saveDraft() {
    if (!isRecording) return Promise.resolve(true);
    const movingMsSnapshot = draftMovingMs();
    if (!pendingDraft
        || pendingDraft.stateVersion !== draftStateVersion
        || pendingDraft.value.movingMs !== movingMsSnapshot) {
        pendingDraft = {
            revision: ++draftRevision,
            stateVersion: draftStateVersion,
            value: {
                format: 2,
                pointCount: points.length,
                pointChunkCount: Math.ceil(points.length / DRAFT_POINTS_CHUNK_SIZE),
                startedAt,
                activityType: recordingActivityType,
                movingMs: movingMsSnapshot,
                totalDistance,
                pois: recordingPois.slice(),
                savedAt: Date.now()
            }
        };
    }
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    clearTimeout(draftSaveMaxWaitTimer);
    draftSaveMaxWaitTimer = null;
    return persistPendingDraft();
}

function persistPendingDraft() {
    if (draftSavePromise) return draftSavePromise;
    const write = async () => {
        while (pendingDraft && pendingDraft.revision > draftSavedRevision) {
            const snapshot = pendingDraft;
            try {
                const chunks = [];
                if (snapshot.value.pointCount > draftSavedPointCount) {
                    const firstChunk = Math.floor(draftSavedPointCount / DRAFT_POINTS_CHUNK_SIZE);
                    for (let index = firstChunk; index < snapshot.value.pointChunkCount; index++) {
                        const start = index * DRAFT_POINTS_CHUNK_SIZE;
                        const end = Math.min(start + DRAFT_POINTS_CHUNK_SIZE, snapshot.value.pointCount);
                        chunks.push({ index, points: points.slice(start, end) });
                    }
                }
                await DB.kvSaveDraft(snapshot.value, chunks);
            } catch (error) {
                console.warn('No se pudo guardar el borrador de la ruta:', error);
                return false;
            }
            draftSavedPointCount = snapshot.value.pointCount;
            draftSavedRevision = snapshot.revision;
        }
        return true;
    };
    draftSavePromise = write().finally(() => { draftSavePromise = null; });
    return draftSavePromise;
}

async function clearDraft() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    clearTimeout(draftSaveMaxWaitTimer);
    draftSaveMaxWaitTimer = null;
    pendingDraft = null;
    if (draftSavePromise) await draftSavePromise;
    try {
        await DB.kvClearDraft();
        draftSavedPointCount = 0;
        draftSavedRevision = 0;
        draftRevision = 0;
        draftStateVersion = 0;
    } catch (error) {
        console.warn('No se pudo borrar el borrador de la ruta:', error);
    }
}

function buildSegments(pts) {
    const segs = [];
    pts.forEach((p, i) => {
        if (i === 0 || p[5] === 1) segs.push([]);
        segs[segs.length - 1].push([p[0], p[1]]);
    });
    return segs;
}

function restoreDraft(d) {
    resetRecordingState();
    points = d.points;
    draftSavedPointCount = d.format === 2 ? points.length : 0;
    recordingPois = Array.isArray(d.pois) ? d.pois.filter(routePoiCoordinatesValid) : [];
    showRoutePoisOnMap([...(followedRoute ? followedRoute.pois : []), ...recordingPois]);
    startedAt = d.startedAt || new Date().toISOString();
    recordingActivityType = Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, d.activityType)
        ? d.activityType
        : activityTypeFromName(d.name) || 'mtb';
    movingMs = d.movingMs || 0;
    totalDistance = d.totalDistance || 0;
    points.forEach((p, index) => {
        if (index > 0 && p[5] === 1) elev.reset();
        elev.add(p[2]);
    });
    isRecording = true;
    isPaused = true;
    resumeBreak = true;
    setBtnState('paused');
    $('m-dist').textContent = totalDistance.toFixed(2);
    $('m-elevation').textContent = Math.round(elev.gain);
    $('m-moving').textContent = fmtClock(Math.floor(movingMs / 1000));
    $('m-time').textContent = fmtClock(totalSec());
    if (map) {
        renderRecordingSegments(buildSegments(points));
        const b = L.latLngBounds([]);
        routePolylines.forEach(polyline => b.extend(polyline.getBounds()));
        if (b.isValid()) map.fitBounds(b, { padding: [30, 30] });
        following = false;
        updateCenterBtn();
    }
    toast('Ruta recuperada y en pausa. Pulsa REANUDAR para continuar.', 6000);
}

function isDraftRecoverable(d) {
    const hasValidDistance = d && (d.totalDistance === undefined || d.totalDistance === null
        || (Number.isFinite(d.totalDistance) && d.totalDistance >= 0));
    return !!(hasValidDistance && Array.isArray(d.points) && d.points.length > 0
        && d.points.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])));
}

async function hydrateDraft(d) {
    if (!d || d.format !== 2) return d;
    if (!Number.isSafeInteger(d.pointCount) || d.pointCount < 0
        || !Number.isSafeInteger(d.pointChunkCount)
        || d.pointChunkCount !== Math.ceil(d.pointCount / DRAFT_POINTS_CHUNK_SIZE)) return null;

    const chunks = await DB.kvGetDraftPointChunks();
    if (chunks.length !== d.pointChunkCount) return null;
    const points = [];
    for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        const expectedLength = Math.min(
            DRAFT_POINTS_CHUNK_SIZE,
            d.pointCount - index * DRAFT_POINTS_CHUNK_SIZE
        );
        if (chunk.index !== index || !Array.isArray(chunk.points)
            || chunk.points.length !== expectedLength) return null;
        chunk.points.forEach(point => points.push(point));
    }
    return { ...d, points };
}

async function maybeRestoreDraft() {
    let d;
    try {
        d = await DB.kvGet('draft');
        if (!d) return;
        d = await hydrateDraft(d);
    } catch (error) {
        console.warn('No se pudo leer el borrador de la ruta:', error);
        return;
    }
    if (!d) {
        await clearDraft();
        return;
    }
    if (isDraftRecoverable(d)) {
        const saved = d.savedAt ? ` · guardada ${new Date(d.savedAt).toLocaleString('es-ES')}` : '';
        const ok = await modal({
            message: `Hay una grabación interrumpida (${(d.totalDistance || 0).toFixed(2)} km${saved}). ¿Quieres recuperarla?`,
            ok: 'Recuperar', cancel: 'Descartar'
        });
        if (ok) { restoreDraft(d); return; }
    }
    await clearDraft();
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'hidden') {
            if (isRecording) await saveDraft();
        } else if (isRecording && !isPaused) {
            updateTimerDisplay();
            acquireWake(); // el wake lock se pierde al ocultar la página
        }
    });
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', async () => { if (isRecording) await saveDraft(); });
}

// ============================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        buildSegments,
        autoPauseMovementThreshold,
        autoResumeMovementThreshold,
        isDraftRecoverable,
        rideAccountRequirement
    };
}
