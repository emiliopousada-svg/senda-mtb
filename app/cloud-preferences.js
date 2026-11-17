'use strict';

const CLOUD_PREFERENCES_COLLECTION = 'mtb_user_preferences';
const CLOUD_PREFERENCES_OWNER_KEY = 'mtb_pro_preferences_owner';
const CLOUD_PREFERENCES_PENDING_PREFIX = 'mtb_pro_preferences_pending_';
const CLOUD_PREFERENCES_DEBOUNCE_MS = 700;
const CLOUD_PREFERENCES_RETRY_INITIAL_MS = 5000;
const CLOUD_PREFERENCES_RETRY_MAX_MS = 60000;
const CLOUD_PREFERENCE_RECORDING_METRICS = [
    'speed', 'dist', 'elev', 'hr', 'cadence', 'power', 'avg-speed', 'moving'
];
const CLOUD_PREFERENCE_DEFAULT_VISIBLE_METRICS = [
    'speed', 'dist', 'elev', 'hr', 'moving'
];
const DEFAULT_CLOUD_PREFERENCES = {
    version: 1,
    routeSound: true,
    routeVibration: true,
    routeVoice: true,
    recordingHaptics: true,
    mapRotation: true,
    largeControls: false,
    mapStyle: 'topographic',
    wheelCircumference: 2100,
    weeklyGoalKm: 100,
    maxHeartRate: null,
    ftpWatts: null,
    recordingMetricOrder: CLOUD_PREFERENCE_RECORDING_METRICS.slice(),
    recordingVisibleMetrics: CLOUD_PREFERENCE_DEFAULT_VISIBLE_METRICS.slice(),
    safetyContacts: []
};
const CLOUD_PREFERENCES_SAFETY_CONTACTS_KEY = 'mtb_pro_safety_contacts';
const CLOUD_PREFERENCES_MAX_SAFETY_CONTACTS = 5;

// Contactos de emergencia: nombre (1-40) y teléfono internacional, sin duplicados.
// Devuelve null si el valor no es una lista (registros antiguos sin contactos).
function cloudPreferencesSafetyContacts(value) {
    if (!Array.isArray(value)) return null;
    const seen = new Set();
    const result = [];
    value.forEach(contact => {
        if (result.length >= CLOUD_PREFERENCES_MAX_SAFETY_CONTACTS || !contact || typeof contact.name !== 'string') return;
        const name = contact.name.trim().slice(0, 40);
        const compact = String(contact.phone || '').trim().replace(/[\s()-]/g, '');
        if (!name || !/^\+?[1-9]\d{6,14}$/.test(compact)) return;
        const phone = compact.startsWith('+') ? compact : `+${compact}`;
        if (seen.has(phone)) return;
        seen.add(phone);
        result.push({ name, phone });
    });
    return result;
}
let cloudPreferencesTimer = null;
let cloudPreferencesSyncPromise = null;
let cloudPreferencesGeneration = 0;
let cloudPreferencesRetryDelayMs = CLOUD_PREFERENCES_RETRY_INITIAL_MS;
let cloudPreferencesApplyingRemote = false;
let cloudPreferencesSyncState = 'signed-out';
let cloudPreferencesFailureNotified = false;

function cloudPreferencesPendingKey(uid, server) {
    return `${CLOUD_PREFERENCES_PENDING_PREFIX}${encodeURIComponent(server)}_${uid}`;
}

function cloudPreferencesOwnerScope(uid, server) {
    return `${server}\n${uid}`;
}

function cloudPreferencesReadJson(key) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
    } catch (error) {
        console.warn(`No se pudo leer la preferencia local ${key}:`, error);
        return null;
    }
}

function cloudPreferencesOrderedIds(value, allowed, fallback) {
    const source = Array.isArray(value) ? value : [];
    const result = source.filter((id, index) => allowed.includes(id) && source.indexOf(id) === index);
    allowed.forEach(id => {
        if (!result.includes(id)) result.push(id);
    });
    return result.length ? result : fallback.slice();
}

function cloudPreferencesOptionalNumber(value, min, max, integer = false) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
        return null;
    }
    return number;
}

function normalizeCloudPreferences(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const style = ['ign', 'topographic', 'cyclosm', 'osm', 'satellite'].includes(source.mapStyle)
        ? source.mapStyle
        : DEFAULT_CLOUD_PREFERENCES.mapStyle;
    const visible = Array.isArray(source.recordingVisibleMetrics)
        ? source.recordingVisibleMetrics.filter((id, index) =>
            CLOUD_PREFERENCE_RECORDING_METRICS.includes(id)
            && source.recordingVisibleMetrics.indexOf(id) === index)
        : DEFAULT_CLOUD_PREFERENCES.recordingVisibleMetrics.slice();

    return {
        version: 1,
        routeSound: typeof source.routeSound === 'boolean' ? source.routeSound : true,
        routeVibration: typeof source.routeVibration === 'boolean' ? source.routeVibration : true,
        routeVoice: typeof source.routeVoice === 'boolean' ? source.routeVoice : true,
        recordingHaptics: typeof source.recordingHaptics === 'boolean' ? source.recordingHaptics : true,
        mapRotation: typeof source.mapRotation === 'boolean' ? source.mapRotation : true,
        largeControls: typeof source.largeControls === 'boolean' ? source.largeControls : false,
        mapStyle: style,
        wheelCircumference: cloudPreferencesOptionalNumber(source.wheelCircumference, 500, 3000)
            ?? DEFAULT_CLOUD_PREFERENCES.wheelCircumference,
        weeklyGoalKm: cloudPreferencesOptionalNumber(source.weeklyGoalKm, 5, 1000)
            ?? DEFAULT_CLOUD_PREFERENCES.weeklyGoalKm,
        maxHeartRate: cloudPreferencesOptionalNumber(source.maxHeartRate, 100, 240, true),
        ftpWatts: cloudPreferencesOptionalNumber(source.ftpWatts, 50, 800),
        recordingMetricOrder: cloudPreferencesOrderedIds(
            source.recordingMetricOrder,
            CLOUD_PREFERENCE_RECORDING_METRICS,
            CLOUD_PREFERENCE_RECORDING_METRICS
        ),
        recordingVisibleMetrics: visible.length ? visible : CLOUD_PREFERENCE_DEFAULT_VISIBLE_METRICS.slice(),
        safetyContacts: cloudPreferencesSafetyContacts(source.safetyContacts) || []
    };
}

function readLocalCloudPreferences() {
    const visibleStored = cloudPreferencesReadJson('mtb_pro_recording_panel_visible_v1');
    let visibleMetrics = visibleStored;
    if (!Array.isArray(visibleMetrics)) {
        visibleMetrics = [...document.querySelectorAll('.m-box[data-metric]')]
            .filter(box => box.dataset.metricVisible !== 'false')
            .map(box => box.dataset.metric);
        if (!visibleMetrics.length) visibleMetrics = CLOUD_PREFERENCE_DEFAULT_VISIBLE_METRICS;
    }
    return normalizeCloudPreferences({
        routeSound: localStorage.getItem('mtb_pro_route_sound') !== '0',
        routeVibration: localStorage.getItem('mtb_pro_route_vibration') !== '0',
        routeVoice: localStorage.getItem('mtb_pro_route_voice') !== '0',
        recordingHaptics: localStorage.getItem('mtb_pro_recording_haptics') !== '0',
        mapRotation: localStorage.getItem('mtb_pro_map_rotation') !== '0',
        largeControls: localStorage.getItem('mtb_pro_large_controls') === '1',
        mapStyle: localStorage.getItem('mtb_pro_map_style') || DEFAULT_CLOUD_PREFERENCES.mapStyle,
        wheelCircumference: localStorage.getItem('mtb_pro_wheel_circumference'),
        weeklyGoalKm: localStorage.getItem('mtb_pro_weekly_goal_km'),
        maxHeartRate: localStorage.getItem('mtb_pro_stats_hr_max'),
        ftpWatts: localStorage.getItem('mtb_pro_stats_ftp'),
        recordingMetricOrder: cloudPreferencesReadJson('mtb_pro_recording_panel_v1'),
        recordingVisibleMetrics: visibleMetrics,
        safetyContacts: cloudPreferencesReadJson(CLOUD_PREFERENCES_SAFETY_CONTACTS_KEY)
    });
}

function setCloudPreferencesSyncState(state) {
    cloudPreferencesSyncState = state;
    renderCloudPreferencesStatus();
}

function renderCloudPreferencesStatus() {
    const status = $('acc-preferences-status');
    if (!status) return;
    if (typeof Cloud === 'undefined' || !Cloud.loggedIn()) {
        status.textContent = 'Inicia sesión para sincronizar tus ajustes entre dispositivos.';
        return;
    }
    const messages = {
        syncing: 'Sincronizando ajustes con PocketBase…',
        synced: 'Ajustes sincronizados con PocketBase.',
        pending: 'Ajustes guardados en este dispositivo; la sincronización está pendiente.',
        'signed-out': 'Inicia sesión para sincronizar tus ajustes entre dispositivos.'
    };
    status.textContent = messages[cloudPreferencesSyncState] || messages.pending;
}

function applyCloudPreferences(value) {
    const preferences = normalizeCloudPreferences(value);
    // Un registro anterior a los contactos en la cuenta no los trae: se conservan los del móvil.
    const remoteHasContacts = Array.isArray(value && value.safetyContacts);
    cloudPreferencesApplyingRemote = true;
    try {
        const localValues = {
            mtb_pro_route_sound: preferences.routeSound ? '1' : '0',
            mtb_pro_route_vibration: preferences.routeVibration ? '1' : '0',
            mtb_pro_route_voice: preferences.routeVoice ? '1' : '0',
            mtb_pro_recording_haptics: preferences.recordingHaptics ? '1' : '0',
            mtb_pro_map_rotation: preferences.mapRotation ? '1' : '0',
            mtb_pro_large_controls: preferences.largeControls ? '1' : '0',
            mtb_pro_map_style: preferences.mapStyle,
            mtb_pro_wheel_circumference: String(preferences.wheelCircumference),
            mtb_pro_weekly_goal_km: String(preferences.weeklyGoalKm),
            mtb_pro_recording_panel_v1: JSON.stringify(preferences.recordingMetricOrder),
            mtb_pro_recording_panel_visible_v1: JSON.stringify(preferences.recordingVisibleMetrics)
        };
        Object.entries(localValues).forEach(([key, localValue]) => localStorage.setItem(key, localValue));
        if (preferences.maxHeartRate === null) localStorage.removeItem('mtb_pro_stats_hr_max');
        else localStorage.setItem('mtb_pro_stats_hr_max', String(preferences.maxHeartRate));
        if (preferences.ftpWatts === null) localStorage.removeItem('mtb_pro_stats_ftp');
        else localStorage.setItem('mtb_pro_stats_ftp', String(preferences.ftpWatts));
        if (remoteHasContacts) {
            localStorage.setItem(CLOUD_PREFERENCES_SAFETY_CONTACTS_KEY, JSON.stringify(preferences.safetyContacts));
            if (typeof safetySetContacts === 'function') safetySetContacts(preferences.safetyContacts);
        }

        const controls = [
            ['setting-route-sound', preferences.routeSound],
            ['setting-route-vibration', preferences.routeVibration],
            ['setting-route-voice', preferences.routeVoice],
            ['setting-recording-haptics', preferences.recordingHaptics],
            ['setting-map-rotation', preferences.mapRotation],
            ['setting-large-controls', preferences.largeControls]
        ];
        controls.forEach(([id, checked]) => {
            const input = $(id);
            if (input) input.checked = checked;
        });
        const mapStyleSelect = $('map-style-select');
        if (mapStyleSelect) mapStyleSelect.value = preferences.mapStyle;
        const circumference = $('sensor-wheel-circumference');
        if (circumference) circumference.value = String(preferences.wheelCircumference);

        document.documentElement.classList.toggle('large-controls', preferences.largeControls);
        if (typeof setMapRotationMode === 'function') setMapRotationMode(preferences.mapRotation);
        if (typeof applyMapStyle === 'function') applyMapStyle();
        if (typeof updateQuickMapStyleButton === 'function') updateQuickMapStyleButton();
        if (typeof applyRecordingPanelPreferences === 'function') applyRecordingPanelPreferences();
        if (typeof renderRecordingPanelSettings === 'function') renderRecordingPanelSettings();
        if (typeof dashboardApplySavedCardOrder === 'function') dashboardApplySavedCardOrder();
        if (typeof dashboardRefreshOrderControls === 'function') dashboardRefreshOrderControls();
        if (typeof statsLoadPreferences === 'function') statsLoadPreferences();
        if (typeof statsRenderDashboard === 'function') statsRenderDashboard();
        if (typeof refreshStats === 'function') refreshStats();
    } finally {
        cloudPreferencesApplyingRemote = false;
    }
}

function clearCloudPreferencesTimer() {
    if (cloudPreferencesTimer !== null) clearTimeout(cloudPreferencesTimer);
    cloudPreferencesTimer = null;
}

function cancelCloudPreferencesSync() {
    clearCloudPreferencesTimer();
    cloudPreferencesGeneration++;
    cloudPreferencesSyncPromise = null;
    cloudPreferencesRetryDelayMs = CLOUD_PREFERENCES_RETRY_INITIAL_MS;
    setCloudPreferencesSyncState('signed-out');
}

function queueCloudPreferencesSync() {
    if (cloudPreferencesApplyingRemote || typeof Cloud === 'undefined' || !Cloud.loggedIn()) return;
    const uid = Cloud.uid;
    const server = Cloud.server;
    try {
        localStorage.setItem(
            cloudPreferencesPendingKey(uid, server),
            JSON.stringify(readLocalCloudPreferences())
        );
    } catch (error) {
        console.warn('No se pudo preparar la sincronización de ajustes:', error);
        toast('No se pudieron preparar tus ajustes para sincronizarlos.', 6000);
        return;
    }
    clearCloudPreferencesTimer();
    setCloudPreferencesSyncState('pending');
    cloudPreferencesTimer = setTimeout(() => {
        cloudPreferencesTimer = null;
        syncCloudPreferences();
    }, CLOUD_PREFERENCES_DEBOUNCE_MS);
}

function scheduleCloudPreferencesRetry(uid, server, generation) {
    if (cloudPreferencesTimer !== null) return;
    const delay = cloudPreferencesRetryDelayMs;
    cloudPreferencesRetryDelayMs = Math.min(CLOUD_PREFERENCES_RETRY_MAX_MS, delay * 2);
    cloudPreferencesTimer = setTimeout(() => {
        cloudPreferencesTimer = null;
        if (generation !== cloudPreferencesGeneration || !navigator.onLine
            || !Cloud.loggedIn() || Cloud.uid !== uid || Cloud.server !== server) return;
        syncCloudPreferences();
    }, delay);
}

async function syncCloudPreferences() {
    if (typeof Cloud === 'undefined' || !Cloud.loggedIn()) {
        setCloudPreferencesSyncState('signed-out');
        return false;
    }
    if (!navigator.onLine) {
        setCloudPreferencesSyncState('pending');
        return false;
    }
    if (cloudPreferencesSyncPromise) return cloudPreferencesSyncPromise;

    clearCloudPreferencesTimer();
    const uid = Cloud.uid;
    const server = Cloud.server;
    const generation = cloudPreferencesGeneration;
    const scope = cloudPreferencesOwnerScope(uid, server);
    const pendingKey = cloudPreferencesPendingKey(uid, server);
    let submittedPending = null;
    let succeeded = false;
    setCloudPreferencesSyncState('syncing');

    const task = (async () => {
        try {
            const pendingRaw = localStorage.getItem(pendingKey);
            let pending = null;
            if (pendingRaw) {
                try { pending = normalizeCloudPreferences(JSON.parse(pendingRaw)); }
                catch (error) {
                    console.warn('Se descartó una preferencia pendiente no válida:', error);
                    localStorage.removeItem(pendingKey);
                }
            }
            submittedPending = pending ? pendingRaw : null;

            const filter = encodeURIComponent(`owner = "${uid}"`);
            const result = await cloudApi(
                `/api/collections/${CLOUD_PREFERENCES_COLLECTION}/records?filter=${filter}&perPage=1`
            );
            if (generation !== cloudPreferencesGeneration || !Cloud.loggedIn()
                || Cloud.uid !== uid || Cloud.server !== server) return false;

            const record = Array.isArray(result.items) ? result.items[0] : null;
            if (!pending && record) {
                const previousOwner = localStorage.getItem(CLOUD_PREFERENCES_OWNER_KEY);
                const ownerChanged = Boolean(previousOwner && previousOwner !== scope);
                const remoteHasContacts = Array.isArray(record.preferences && record.preferences.safetyContacts);
                // Contactos de otra cuenta no se heredan; los de este móvil se suben si la cuenta aún no tiene.
                if (!remoteHasContacts && ownerChanged) {
                    localStorage.setItem(CLOUD_PREFERENCES_SAFETY_CONTACTS_KEY, '[]');
                    if (typeof safetySetContacts === 'function') safetySetContacts([]);
                }
                applyCloudPreferences(record.preferences);
                localStorage.setItem(CLOUD_PREFERENCES_OWNER_KEY, scope);
                cloudPreferencesRetryDelayMs = CLOUD_PREFERENCES_RETRY_INITIAL_MS;
                cloudPreferencesFailureNotified = false;
                setCloudPreferencesSyncState('synced');
                succeeded = true;
                const localContacts = cloudPreferencesSafetyContacts(
                    cloudPreferencesReadJson(CLOUD_PREFERENCES_SAFETY_CONTACTS_KEY)
                ) || [];
                if (!remoteHasContacts && localContacts.length) setTimeout(queueCloudPreferencesSync, 0);
                return true;
            }

            let preferences = pending;
            if (!preferences) {
                const previousOwner = localStorage.getItem(CLOUD_PREFERENCES_OWNER_KEY);
                if (previousOwner && previousOwner !== scope) {
                    applyCloudPreferences(DEFAULT_CLOUD_PREFERENCES);
                    preferences = normalizeCloudPreferences(DEFAULT_CLOUD_PREFERENCES);
                } else preferences = readLocalCloudPreferences();
            }

            const payload = { preferences };
            const saved = record
                ? await cloudApi(`/api/collections/${CLOUD_PREFERENCES_COLLECTION}/records/${encodeURIComponent(record.id)}`, 'PATCH', payload)
                : await cloudApi(`/api/collections/${CLOUD_PREFERENCES_COLLECTION}/records`, 'POST', { owner: uid, ...payload });
            if (generation !== cloudPreferencesGeneration || !Cloud.loggedIn()
                || Cloud.uid !== uid || Cloud.server !== server) return false;

            localStorage.setItem(CLOUD_PREFERENCES_OWNER_KEY, scope);
            if (submittedPending && localStorage.getItem(pendingKey) === submittedPending) {
                localStorage.removeItem(pendingKey);
            }
            cloudPreferencesRetryDelayMs = CLOUD_PREFERENCES_RETRY_INITIAL_MS;
            cloudPreferencesFailureNotified = false;
            setCloudPreferencesSyncState('synced');
            succeeded = true;
            return Boolean(saved);
        } catch (error) {
            if (generation !== cloudPreferencesGeneration || !Cloud.loggedIn()
                || Cloud.uid !== uid || Cloud.server !== server) return false;
            console.warn('No se pudieron sincronizar las preferencias con PocketBase:', error);
            setCloudPreferencesSyncState('pending');
            if (error.retryable) scheduleCloudPreferencesRetry(uid, server, generation);
            if (!cloudPreferencesFailureNotified) {
                cloudPreferencesFailureNotified = true;
                toast(error.status === 404
                    ? 'Falta instalar en PocketBase la colección de preferencias. Los ajustes siguen guardados localmente.'
                    : 'No se pudieron sincronizar los ajustes; siguen guardados localmente.', 7000);
            }
            return false;
        }
    })();

    cloudPreferencesSyncPromise = task;
    try {
        return await task;
    } finally {
        if (cloudPreferencesSyncPromise === task) cloudPreferencesSyncPromise = null;
        if (succeeded && generation === cloudPreferencesGeneration
            && Cloud.loggedIn() && Cloud.uid === uid && Cloud.server === server) {
            const currentPending = localStorage.getItem(pendingKey);
            if (currentPending && currentPending !== submittedPending && cloudPreferencesTimer === null) {
                cloudPreferencesTimer = setTimeout(() => {
                    cloudPreferencesTimer = null;
                    syncCloudPreferences();
                }, 0);
            }
        }
    }
}
