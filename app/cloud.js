'use strict';

//  CUENTA Y SINCRONIZACIÓN (servidor PocketBase propio)
// ============================================================
const CLOUD_SYNC_RETRY_INITIAL_MS = 5000;
const CLOUD_SYNC_RETRY_MAX_MS = 60000;
let cloudSyncRetryTimer = null;
let cloudSyncRetryDelayMs = CLOUD_SYNC_RETRY_INITIAL_MS;
let cloudSyncRetryGeneration = 0;

function clearCloudSyncRetryTimer() {
    if (cloudSyncRetryTimer !== null) clearTimeout(cloudSyncRetryTimer);
    cloudSyncRetryTimer = null;
}

function cancelCloudSyncRetry() {
    clearCloudSyncRetryTimer();
    cloudSyncRetryDelayMs = CLOUD_SYNC_RETRY_INITIAL_MS;
    cloudSyncRetryGeneration++;
}

function scheduleCloudSyncRetry(uid, server, generation) {
    if (cloudSyncRetryTimer !== null) return;
    const delay = cloudSyncRetryDelayMs;
    cloudSyncRetryDelayMs = Math.min(CLOUD_SYNC_RETRY_MAX_MS, cloudSyncRetryDelayMs * 2);
    cloudSyncRetryTimer = setTimeout(() => {
        cloudSyncRetryTimer = null;
        if (generation !== cloudSyncRetryGeneration || !navigator.onLine
            || !Cloud.loggedIn() || Cloud.uid !== uid || Cloud.server !== server) return;
        syncRoutes();
    }, delay);
}

const Cloud = {
    sessionActive: false,
    authGeneration: 0,
    profileGeneration: 0,
    serverSwitchInFlight: false,
    logoutInProgress: false,
    get server() {
        const stored = localStorage.getItem('mtb_pro_server');
        return normalizeServer(stored || DEFAULT_CLOUD_SERVER);
    },
    setServer(nextServer) {
        const normalized = normalizeServer(nextServer || DEFAULT_CLOUD_SERVER);
        const current = this.server;
        if (current !== normalized && (this.loggedIn() || this.serverSwitchInFlight)) {
            throw new Error('Cambia el servidor desde sus ajustes para revocar primero la sesión actual.');
        }
        localStorage.setItem('mtb_pro_server', normalized);
        if (current && current !== normalized) this.clearSession();
        return normalized;
    },
    async switchServer(nextServer) {
        const normalized = normalizeServer(nextServer || DEFAULT_CLOUD_SERVER);
        const current = this.server;
        if (current === normalized) return normalized;
        if (this.serverSwitchInFlight
            || (typeof accAuthInFlight !== 'undefined' && accAuthInFlight)
            || (typeof logoutInFlight !== 'undefined' && logoutInFlight)) {
            throw new Error('Espera a que termine la operación de cuenta antes de cambiar de servidor.');
        }

        const uid = this.uid;
        const generation = this.authGeneration;
        this.serverSwitchInFlight = true;
        try {
            await cloudApi('/api/mtb/auth/logout', 'POST', {}, { server: current });
            if (this.server !== current || this.uid !== uid || this.authGeneration !== generation) {
                throw new Error('La sesión cambió durante el cambio de servidor. Vuelve a intentarlo.');
            }
            if (typeof stopGroup === 'function') {
                try { await stopGroup(); }
                catch (error) { console.warn('No se pudo detener el grupo al cambiar de servidor:', error); }
            }
            if (this.server !== current || this.uid !== uid || this.authGeneration !== generation) {
                throw new Error('La sesión cambió durante el cambio de servidor. Vuelve a intentarlo.');
            }
            localStorage.setItem('mtb_pro_server', normalized);
            this.clearSession();
            return normalized;
        } finally {
            this.serverSwitchInFlight = false;
        }
    },
    get uid()    { return localStorage.getItem('mtb_pro_uid') || ''; },
    get email()  { return localStorage.getItem('mtb_pro_email') || ''; },
    get nickname() { return localStorage.getItem('mtb_pro_nickname') || ''; },
    get groupCode() { return localStorage.getItem('mtb_pro_group_code') || ''; },
    invalidateProfileReads() {
        this.profileGeneration++;
    },
    loggedIn()   { return !!(this.server && this.sessionActive && this.uid); },
    setSession(rec) {
        if (!this.sessionActive || this.uid !== rec.id) this.authGeneration++;
        if (this.groupCode !== (rec.groupCode || '')) this.profileGeneration++;
        this.sessionActive = true;
        localStorage.removeItem('mtb_pro_token');
        localStorage.setItem('mtb_pro_uid', rec.id);
        localStorage.setItem('mtb_pro_avatar_last_uid', rec.id);
        localStorage.setItem('mtb_pro_email', rec.email || '');
        if (rec.nickname) localStorage.setItem('mtb_pro_nickname', String(rec.nickname).trim().slice(0, ROUTE_NICKNAME_LIMIT));
        else localStorage.removeItem('mtb_pro_nickname');
        localStorage.setItem('mtb_pro_group_code', rec.groupCode || '');
        if (typeof renderAccountAvatar === 'function') renderAccountAvatar();
        if (typeof dashboardUpdateGreeting === 'function') dashboardUpdateGreeting();
    },
    async refreshSession() {
        const server = this.server;
        const uid = this.uid;
        const generation = this.authGeneration;
        const profileGeneration = this.profileGeneration;
        if (!this.loggedIn()) return null;

        let result;
        try {
            result = await cloudApi('/api/mtb/auth/session');
        } catch (error) {
            if (server !== this.server || uid !== this.uid || generation !== this.authGeneration
                || profileGeneration !== this.profileGeneration || !this.loggedIn()) return null;
            throw error;
        }
        if (!result || !result.record || !result.record.id) {
            throw new Error('El servidor no devolvió una sesión válida.');
        }
        if (server !== this.server || uid !== this.uid || generation !== this.authGeneration
            || profileGeneration !== this.profileGeneration || !this.loggedIn()) return null;
        if (result.record.id !== uid) {
            this.clearSession();
            return null;
        }
        this.setSession(result.record);
        return result.record;
    },
    async restoreSession() {
        const generation = this.authGeneration;
        try {
            const result = await cloudApi('/api/mtb/auth/session');
            if (!result || !result.record || !result.record.id) {
                throw new Error('El servidor no devolvió una sesión válida.');
            }
            if (generation !== this.authGeneration) return null;
            this.setSession(result.record);
            return result.record;
        } catch (error) {
            if (generation !== this.authGeneration) return null;
            if (error.status === 401) this.clearSession();
            throw error;
        }
    },
    clearSession() {
        this.authGeneration++;
        this.sessionActive = false;
        cancelCloudSyncRetry();
        if (typeof cancelCloudPreferencesSync === 'function') cancelCloudPreferencesSync();
        ['mtb_pro_token', 'mtb_pro_uid', 'mtb_pro_email', 'mtb_pro_nickname', 'mtb_pro_group_code'].forEach(k => localStorage.removeItem(k));
        if (typeof resetAccountProfileCache === 'function') resetAccountProfileCache();
        if (typeof renderAccountAvatar === 'function') renderAccountAvatar();
        if (typeof dashboardUpdateGreeting === 'function') dashboardUpdateGreeting();
    }
};
localStorage.removeItem('mtb_pro_token');

let cloudServerWasResetOnLoad = false;
try {
    void Cloud.server;
} catch (error) {
    console.warn('La dirección de servidor guardada no es válida:', error);
    localStorage.setItem('mtb_pro_server', DEFAULT_CLOUD_SERVER);
    Cloud.clearSession();
    cloudServerWasResetOnLoad = true;
}

const CLOUD_TIMEOUT_MS = 10000;
const ROUTE_NICKNAME_LIMIT = 32;
const ROUTE_FULL_AUDIT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROUTE_SYNC_CURSOR_OVERLAP_MS = 5000;

function cloudSyncStorageKey(name, server = Cloud.server, uid = Cloud.uid) {
    return `mtb_pro_${name}_${encodeURIComponent(server)}_${uid}`;
}

async function fetchRemoteRoutes(fullAudit, cursor, api = cloudApi, isCurrent = () => true, server = Cloud.server, uid = Cloud.uid) {
    const unsupportedKey = cloudSyncStorageKey('routes_incremental_unsupported', server, uid);
    const fetchPages = async (sort, filter = '') => {
        const remote = [];
        for (let page = 1; ; page++) {
            const result = await api(`/api/collections/routes/records?page=${page}&perPage=200&sort=${sort}${filter}`);
            if (!isCurrent()) return null;
            remote.push(...result.items);
            if (page >= result.totalPages) break;
        }
        return remote;
    };
    if (fullAudit || localStorage.getItem(unsupportedKey) === '1') {
        const records = await fetchPages('clientId');
        return isCurrent() ? { records, fullAudit: true } : null;
    }
    let since = '';
    if (cursor) {
        const cursorMs = Date.parse(cursor);
        if (Number.isFinite(cursorMs)) since = new Date(Math.max(0, cursorMs - ROUTE_SYNC_CURSOR_OVERLAP_MS)).toISOString();
    }
    const filter = since ? `&filter=${encodeURIComponent(`updated >= "${since}"`)}` : '';
    try {
        const records = await fetchPages('updated,clientId', filter);
        return isCurrent() ? { records, fullAudit: false } : null;
    } catch (error) {
        if (!isCurrent()) return null;
        if (error.status !== 400) throw error;
        // Algunas instalaciones antiguas no tienen el campo updated en routes.
        // Reconciliar todo mantiene la sincronización funcional sin cambiar el esquema del servidor.
        const remote = await fetchPages('clientId');
        if (!isCurrent()) return null;
        localStorage.setItem(unsupportedKey, '1');
        console.warn('La colección routes no admite sincronización incremental; se usará reconciliación completa.', error);
        return { records: remote, fullAudit: true };
    }
}

function newestRemoteUpdate(records, fallbackMs) {
    const latest = records.reduce((value, record) => {
        const updated = Date.parse(record.updated || record.created || '');
        return Number.isFinite(updated) ? Math.max(value, updated) : value;
    }, 0);
    return new Date(Math.max(0, (latest || fallbackMs) - ROUTE_SYNC_CURSOR_OVERLAP_MS)).toISOString();
}

function normalizeRemoteTrack(raw) {
    let value = raw;
    for (let depth = 0; depth < 3 && typeof value === 'string'; depth++) {
        try { value = JSON.parse(value); }
        catch (_) { return null; }
    }

    let geoJson = false;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (value.type === 'Feature') value = value.geometry;
        else if (value.type === 'FeatureCollection') {
            geoJson = true;
            value = (Array.isArray(value.features) ? value.features : [])
                .map(feature => feature && feature.geometry)
                .filter(geometry => geometry && ['LineString', 'MultiLineString'].includes(geometry.type))
                .map(geometry => geometry.coordinates);
        }
        if (value && !Array.isArray(value) && ['LineString', 'MultiLineString'].includes(value.type)) {
            geoJson = true;
            value = value.coordinates;
        } else if (value && !Array.isArray(value)) {
            value = value.points ?? value.trackPoints ?? value.routePoints ?? value.coords ??
                value.segments ?? value.lines ?? value.track ?? value.coordinates ?? value.data;
        }
    }

    const pointFrom = (item, reverseCoordinates) => {
        let point;
        if (Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))) {
            point = reverseCoordinates
                ? [Number(item[1]), Number(item[0]), ...item.slice(2)]
                : [Number(item[0]), Number(item[1]), ...item.slice(2)];
        } else if (item && typeof item === 'object') {
            const lat = Number(item.lat ?? item.latitude);
            const lng = Number(item.lng ?? item.lon ?? item.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            point = [lat, lng, item.altitude ?? item.alt ?? null, item.time ?? null, item.hr ?? null];
        } else return null;
        if (Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180) return null;
        while (point.length < 6) point.push(null);
        return point;
    };

    const points = [];
    const appendSegment = (segment, reverseCoordinates, startsNewSegment = false) => {
        if (!Array.isArray(segment) || !segment.length) return false;
        const parsed = segment.map(item => pointFrom(item, reverseCoordinates));
        if (parsed.some(point => !point)) return false;
        if (startsNewSegment && points.length) parsed[0][5] = 1;
        points.push(...parsed);
        return true;
    };
    const visit = (items, reverseCoordinates = geoJson) => {
        if (!Array.isArray(items) || !items.length) return false;
        if (pointFrom(items[0], reverseCoordinates)) return appendSegment(items, reverseCoordinates, false);
        let added = false;
        for (const segment of items) {
            const before = points.length;
            if (Array.isArray(segment) && pointFrom(segment[0], reverseCoordinates)) {
                added = appendSegment(segment, reverseCoordinates, before > 0) || added;
            } else {
                added = visit(segment, reverseCoordinates) || added;
                if (points.length > before && before > 0) points[before][5] = 1;
            }
        }
        return added;
    };

    visit(value);
    return points.length >= 2 ? points : null;
}

function getRouteNickname() {
    return String(Cloud.nickname || '').trim().slice(0, ROUTE_NICKNAME_LIMIT);
}

// body: objeto (JSON), FormData (archivos) o null
function isRetryableCloudStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}

async function cloudApi(path, method = 'GET', body = null, options = {}) {
    const timeoutMs = typeof options === 'number' ? options : (options?.timeoutMs || CLOUD_TIMEOUT_MS);
    const headers = {};
    if (typeof options === 'object' && options?.authorization) {
        headers.Authorization = options.authorization;
    }
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const server = typeof options === 'object' && options?.server ? options.server : Cloud.server;
    const url = new URL(server + path);
    const isLocalHttp = APP_CONFIG.allowLocalHttpServer
        && url.protocol === 'http:'
        && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
    if ((url.protocol !== 'https:' && !isLocalHttp) || url.username || url.password) {
        throw new Error('El servidor debe usar una dirección HTTPS válida.');
    }

    const controller = new AbortController();
    if (options?.signal) {
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else options.signal.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });
    }
    const timer = setTimeout(() => {
        const timeoutErr = new Error('Tiempo de espera agotado al conectar con el servidor');
        timeoutErr.name = 'TimeoutError';
        controller.abort(timeoutErr);
    }, timeoutMs);

    try {
        const res = await fetch(url.href, {
            method,
            headers,
            body: payload,
            signal: controller.signal,
            credentials: 'include',
            cache: 'no-store',
            redirect: 'error'
        });
        if (!res.ok) {
            let msg = '';
            try {
                const j = await res.json();
                msg = j.message || '';
                const f = j.data ? Object.entries(j.data).map(([k, v]) => `${k}: ${v.message}`).join('; ') : '';
                if (f) msg += ` (${f})`;
            } catch (e) {}
            const err = new Error(msg || ('Error ' + res.status));
            err.status = res.status; // sin status = no se pudo conectar
            err.retryable = isRetryableCloudStatus(res.status);
            throw err;
        }
        return res.status === 204 ? null : await res.json();
    } catch (e) {
        if (e.name === 'AbortError' || e.name === 'TimeoutError') {
            const timeoutErr = new Error('Tiempo de espera agotado al conectar con el servidor');
            timeoutErr.retryable = !options?.signal?.aborted;
            throw timeoutErr;
        }
        if (e.status === undefined && e.retryable === undefined) e.retryable = true;
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

function normalizeServer(v) {
    // Se declara dentro de la función: Cloud la llama al cargar el script, antes de esta línea.
    const LOCAL_HTTP_SERVER = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/.*)?$/i;
    v = String(v || '').trim().replace(/\/+$/, '');
    if (!v) return '';
    // Solo en desarrollo se admite un PocketBase local sin TLS; en el resto de entornos se exige HTTPS.
    if (APP_CONFIG.allowLocalHttpServer && LOCAL_HTTP_SERVER.test(v)) {
        const local = new URL(v);
        if (local.username || local.password || local.search || local.hash) {
            throw new Error('La dirección del servidor no es válida.');
        }
        return `${local.origin}${local.pathname}`.replace(/\/+$/, '');
    }
    if (/^http:\/\//i.test(v)) v = v.replace(/^http:/i, 'https:');
    else if (/^[a-z][a-z\d+.-]*:\/\//i.test(v) && !/^https:\/\//i.test(v)) {
        throw new Error('El servidor debe usar HTTPS.');
    } else if (!/^https:\/\//i.test(v)) v = 'https://' + v;

    let url;
    try { url = new URL(v); }
    catch (error) { throw new Error('La dirección del servidor no es válida.'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
        throw new Error('El servidor debe usar una dirección HTTPS válida.');
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function renderAccount() {
    renderAccountServer();
    const on = Cloud.loggedIn();
    $('acc-form').style.display = on ? 'none' : 'block';
    $('acc-logged').style.display = on ? 'block' : 'none';
    const hasNickname = Boolean(Cloud.nickname);
    $('acc-nickname-setup').hidden = !on || hasNickname;
    $('acc-ready').hidden = !on || !hasNickname;
    if (hasNickname) {
        $('acc-account-nickname').value = Cloud.nickname;
        $('acc-nickname-summary').textContent = `Apodo: ${Cloud.nickname}`;
    }
    const last = localStorage.getItem('mtb_pro_lastsync');
    const syncFailures = Number(localStorage.getItem('mtb_pro_sync_failures') || 0);
    $('acc-status').textContent = on
        ? `Conectado como ${Cloud.email}` + (Cloud.groupCode ? ' · grupo asignado' : ' · sin grupo asignado') + (last ? ` · última sincronización: ${new Date(Number(last)).toLocaleString('es-ES')}` : '') + (syncFailures ? ` · sincronización parcial: ${syncFailures} elemento(s) pendiente(s)` : '')
        : 'Sin sesión: tus rutas se guardan solo en este móvil.';
    if (typeof renderCloudPreferencesStatus === 'function') renderCloudPreferencesStatus();
}

function renderAccountServer() {
    const serverInput = $('acc-server');
    if (serverInput) {
        try { serverInput.textContent = Cloud.server || 'Sin servidor configurado'; }
        catch (error) { serverInput.textContent = 'Sin servidor configurado'; }
    }
}

// Evita peticiones duplicadas si se pulsa varias veces mientras se autentica.
let accAuthInFlight = false;
let logoutInFlight = false;
async function accAuthOnce(register) {
    if (accAuthInFlight) return;
    if (Cloud.serverSwitchInFlight) {
        toast('Espera a que termine el cambio de servidor.');
        return;
    }
    if (logoutInFlight) {
        toast('Espera a que termine el cierre de sesión.');
        return;
    }
    accAuthInFlight = true;
    const buttons = [$('acc-login'), $('acc-register')];
    buttons.forEach(button => { if (button) button.disabled = true; });
    // Indica a los gestores de contraseñas si es una contraseña nueva.
    $('acc-pass').autocomplete = register ? 'new-password' : 'current-password';
    try { await accAuth(register); }
    finally {
        accAuthInFlight = false;
        buttons.forEach(button => { if (button) button.disabled = false; });
    }
}

function ensureAuthServer(server, generation) {
    if (Cloud.server === server && Cloud.authGeneration === generation) return;
    const error = new Error('El servidor o la sesión cambió durante el inicio de sesión. Vuelve a intentarlo.');
    error.code = 'CLOUD_AUTH_CONTEXT_CHANGED';
    throw error;
}

async function accAuth(register) {
    const server = Cloud.server;
    const nickname = $('acc-nickname').value.trim().slice(0, ROUTE_NICKNAME_LIMIT);
    const email = $('acc-email').value.trim();
    const pass = $('acc-pass').value;
    if (!email || !pass) { toast('Rellena correo y contraseña'); return; }
    if (register && !nickname) { toast('Escribe un apodo para crear la cuenta.'); $('acc-nickname').focus(); return; }
    if (register && pass.length < 8) { toast('La contraseña debe tener al menos 8 caracteres'); return; }
    const weightKg = $('acc-weight').value.trim();
    const heightCm = $('acc-height')?.value.trim() || '';
    const age = $('acc-age').value.trim();
    if (weightKg && (!Number.isFinite(Number(weightKg)) || Number(weightKg) < 25 || Number(weightKg) > 250)) { toast('El peso debe estar entre 25 y 250 kg.'); return; }
    if (heightCm && (!Number.isInteger(Number(heightCm)) || Number(heightCm) < 120 || Number(heightCm) > 230)) { toast('La altura debe estar entre 120 y 230 cm.'); return; }
    if (age && (!Number.isInteger(Number(age)) || Number(age) < 10 || Number(age) > 100)) { toast('La edad debe estar entre 10 y 100 años.'); return; }
    localStorage.setItem('mtb_pro_server', server);
    Cloud.clearSession();
    const authGeneration = Cloud.authGeneration;
    try {
        if (register) {
            const profile = { email, password: pass, passwordConfirm: pass, nickname };
            if (weightKg) profile.weightKg = Number(weightKg);
            if (heightCm) profile.heightCm = Number(heightCm);
            if (age) profile.age = Number(age);
            await cloudApi('/api/collections/users/records', 'POST', profile);
            ensureAuthServer(server, authGeneration);
        }
        const auth = await cloudApi('/api/collections/users/auth-with-password', 'POST', { identity: email, password: pass });
        let session;
        try {
            ensureAuthServer(server, authGeneration);
            session = await cloudApi('/api/mtb/auth/session/exchange', 'POST', {}, { authorization: auth.token });
            ensureAuthServer(server, authGeneration);
        } finally {
            auth.token = '';
        }
        Cloud.setSession(session.record);
        renderAccountProfile(session.record);
        if ((weightKg || age || heightCm) && typeof statsApplyAccountProfile === 'function') {
            statsApplyAccountProfile(session.record.weightKg ?? (weightKg ? Number(weightKg) : undefined),
                session.record.age ?? (age ? Number(age) : undefined),
                session.record.heightCm ?? (heightCm ? Number(heightCm) : undefined));
        }
        try { await syncPendingAccountAvatar(session.record); }
        catch (avatarError) { console.warn('No se pudo sincronizar el avatar pendiente:', avatarError); }
        await syncCloudPreferences();
        $('acc-pass').value = '';
        $('acc-weight').value = '';
        if ($('acc-height')) $('acc-height').value = '';
        $('acc-age').value = '';
        renderAccount();
        if (!Cloud.nickname && nickname) $('acc-account-nickname').value = nickname;
        await restoreGroup();
        toast(register ? '✅ Cuenta creada' : '✅ Sesión iniciada');
        if (Cloud.nickname) syncRoutes(true);
        const poisSynced = await syncSharedPois(true);
        if (!poisSynced && pendingSharedPoiCount()) {
            toast(`${pendingSharedPoiCount()} punto(s) del mapa siguen pendientes: ${poiSyncPendingMessage()}`, 8000);
        }
    } catch (e) {
        console.warn('Auth:', e);
        toast(e.code === 'CLOUD_AUTH_CONTEXT_CHANGED'
            ? e.message
            : e.status === undefined
                ? 'No se pudo conectar; comprueba tu conexión.'
                : (register ? 'No se pudo crear la cuenta: ' : 'No se pudo entrar: ') + e.message, 6000);
    }
}

async function saveAccountNickname() {
    const nickname = $('acc-account-nickname').value.trim().slice(0, ROUTE_NICKNAME_LIMIT);
    if (!nickname) { toast('Escribe un apodo para completar tu cuenta.'); $('acc-account-nickname').focus(); return; }
    const button = $('acc-nickname-save');
    button.disabled = true;
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const isCurrent = () => Cloud.loggedIn() && Cloud.server === server
        && Cloud.uid === uid && Cloud.authGeneration === generation;
    try {
        const updated = await cloudApi(`/api/collections/users/records/${encodeURIComponent(uid)}`, 'PATCH', { nickname });
        if (!isCurrent() || updated.id !== uid) return;
        localStorage.setItem('mtb_pro_nickname', String(updated.nickname || nickname).trim().slice(0, ROUTE_NICKNAME_LIMIT));
        renderAccount();
        toast('Apodo guardado en tu cuenta.');
        syncRoutes();
        syncSharedPois();
    } catch (error) {
        if (error.status === 401 && isCurrent()) {
            Cloud.clearSession();
            renderAccount();
            toast('La sesión ha caducado. Vuelve a entrar.', 5000);
            return;
        }
        console.warn('No se pudo guardar el apodo de la cuenta:', error);
        toast('No se pudo guardar el apodo: ' + error.message, 6000);
    } finally { button.disabled = false; }
}

async function logoutCloudAccount() {
    if (logoutInFlight || Cloud.serverSwitchInFlight) return;
    logoutInFlight = true;
    Cloud.logoutInProgress = true;
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const activeGroupId = localStorage.getItem('mtb_pro_group_joined') || '';
    const sameAuthContext = () => Cloud.server === server && Cloud.uid === uid
        && Cloud.authGeneration === generation;
    try {
        await stopGroup();
        if (!sameAuthContext()) return;
        try {
            await cloudApi('/api/mtb/auth/logout', 'POST', {});
        } catch (error) {
            if (!sameAuthContext()) return;
            if (error.status !== 401) {
                console.warn('No se pudo revocar la sesión en el servidor:', error);
                if (activeGroupId && Cloud.groupCode === activeGroupId) {
                    localStorage.setItem('mtb_pro_group_joined', activeGroupId);
                    Cloud.logoutInProgress = false;
                    await restoreGroup();
                    if (!sameAuthContext()) return;
                }
                toast('No se pudo cerrar la sesión en el servidor. Comprueba la conexión e inténtalo de nuevo.', 6000);
                return;
            }
        }
        if (!sameAuthContext()) return;
        Cloud.clearSession();
        renderFriends();
        renderAccount();
        toast('Sesión cerrada. Tus rutas siguen en este móvil.');
    } finally {
        logoutInFlight = false;
        Cloud.logoutInProgress = false;
    }
}

async function putLocal(r) { await DB.put(r); }

async function queueRemoteDelete(remoteId) {
    try {
        const p = (await DB.kvGet('pendingDeletes')) || [];
        p.push(remoteId);
        await DB.kvSet('pendingDeletes', p);
    } catch (e) {}
}

function routeForm(r) {
    const route = r && typeof r === 'object' ? r : {};
    const fd = new FormData();
    fd.append('owner', Cloud.uid);
    fd.append('clientId', String(route.id ?? Date.now()));
    fd.append('name', String(route.name ?? 'Ruta sin nombre'));
    if (route.createdBy) fd.append('createdBy', String(route.createdBy).slice(0, ROUTE_NICKNAME_LIMIT));
    fd.append('kind', route.kind || 'recorded');
    fd.append('startedAt', route.startedAt || new Date().toISOString());
    fd.append('movingTimeSec', String(route.movingTimeSec || 0));
    fd.append('distanceKm', String(route.distanceKm || 0));
    fd.append('elevationGain', String(route.elevationGain || 0));
    fd.append('hrAvg', String(route.hrAvg ?? 0));
    fd.append('track', new Blob([JSON.stringify(Array.isArray(route.points) ? route.points : [])], { type: 'application/json' }), 'track.json');
    return fd;
}

let syncing = false, syncQueued = false, syncQueuedManual = false;
let syncQueuedUid = '', syncQueuedServer = '', syncQueuedAuthGeneration = -1;
async function syncRoutes(manual = false) {
    if (!Cloud.loggedIn()) return;
    if (syncing) {
        const sameQueuedContext = syncQueued && syncQueuedUid === Cloud.uid
            && syncQueuedServer === Cloud.server
            && syncQueuedAuthGeneration === Cloud.authGeneration;
        if (!sameQueuedContext) syncQueuedManual = Boolean(manual);
        else syncQueuedManual = syncQueuedManual || manual;
        syncQueued = true;
        syncQueuedUid = Cloud.uid;
        syncQueuedServer = Cloud.server;
        syncQueuedAuthGeneration = Cloud.authGeneration;
        return;
    }
    if (!Cloud.nickname) {
        if (manual) toast('Completa el apodo de tu cuenta antes de sincronizar rutas.');
        return;
    }
    if (!navigator.onLine) { if (manual) toast('Sin conexión: se sincronizará cuando vuelva internet'); return; }
    clearCloudSyncRetryTimer();
    if (manual) cloudSyncRetryDelayMs = CLOUD_SYNC_RETRY_INITIAL_MS;
    const retryUid = Cloud.uid;
    const retryServer = Cloud.server;
    const retryGeneration = cloudSyncRetryGeneration;
    const retryAuthGeneration = Cloud.authGeneration;
    const isCurrentSync = () => Cloud.loggedIn() && Cloud.uid === retryUid
        && Cloud.server === retryServer && Cloud.authGeneration === retryAuthGeneration;
    const syncCloudApi = (path, method, body, options) => {
        if (!isCurrentSync()) return Promise.resolve(null);
        const apiOptions = options && typeof options === 'object' ? options : {};
        return cloudApi(path, method, body, { ...apiOptions, server: retryServer });
    };
    syncing = true;
    $('acc-status').textContent = 'Sincronizando…';
    let pushed = 0, pulled = 0, syncFailures = 0, garageUsageChanged = false;
    let retryableSyncFailure = false;
    let permanentSyncFailure = false;
    const syncFailureDetails = [];
    const markSyncError = error => {
        if (error && error.retryable === true) retryableSyncFailure = true;
        else if (error && Number.isFinite(error.status)) permanentSyncFailure = true;
    };
    const noteSyncFailure = (message, error = null) => {
        syncFailures++;
        if (syncFailureDetails.length < 3 && message) syncFailureDetails.push(String(message).slice(0, 150));
        markSyncError(error);
    };
    let groupRankingFailureNotified = false;
    const syncRouteRanking = async route => {
        if (!isCurrentSync()) return;
        try {
            await shareRouteToGroupRanking(route, null, {
                automatic: true,
                server: retryServer,
                uid: retryUid,
                api: syncCloudApi,
                isCurrent: isCurrentSync
            });
        } catch (error) {
            if (!isCurrentSync()) return;
            const message = `La ruta «${route.name || 'sin nombre'}» se subió, pero no se pudo añadir al ranking: ${error.message || 'error del servidor'}`;
            noteSyncFailure(message, error);
            console.warn(message, error);
            if (!manual && !groupRankingFailureNotified) {
                toast(message, 7000);
                groupRankingFailureNotified = true;
            }
        }
    };
    const hasPendingGroupRanking = route => route.kind === 'recorded' && (
        route.groupRankingPending
        || (route.groupRankingOwnerId === retryUid
            && route.groupRankingServer === retryServer
            && !route.groupRankingGroupId)
    );
    const cursorKey = cloudSyncStorageKey('routes_sync_cursor', retryServer, retryUid);
    const auditKey = cloudSyncStorageKey('routes_full_audit_at', retryServer, retryUid);
    let cursor = '', lastFullAudit = 0;
    try {
        cursor = localStorage.getItem(cursorKey) || '';
        lastFullAudit = Number(localStorage.getItem(auditKey) || 0);
    } catch (e) { console.warn('No se pudo leer el estado incremental de rutas; se hará una reconciliación completa:', e); }
    let fullAudit = manual || !cursor || !lastFullAudit || Date.now() - lastFullAudit >= ROUTE_FULL_AUDIT_INTERVAL_MS;
    const syncStartedAt = Date.now();
    try {
        // 0) renovar la sesión (si ha caducado, se cierra)
        try {
            const record = await Cloud.refreshSession();
            if (!record) return;
            renderAccountProfile(record);
            if (!isCurrentSync()) return;
            try { await syncPendingAccountAvatar(record); }
            catch (avatarError) {
                if (!isCurrentSync()) return;
                markSyncError(avatarError);
                console.warn('No se pudo sincronizar el avatar pendiente:', avatarError);
            }
            if (!isCurrentSync()) return;
        } catch (e) {
            if (e.status === 401) {
                Cloud.clearSession();
                toast('La sesión ha caducado. Vuelve a entrar.', 5000);
                return;
            }
            throw e;
        }

        // 1) rutas que ya hay en el servidor
        const routeInventory = await fetchRemoteRoutes(fullAudit, cursor, syncCloudApi, isCurrentSync, retryServer, retryUid);
        if (!isCurrentSync() || !routeInventory) return;
        const remote = routeInventory.records;
        fullAudit = routeInventory.fullAudit;
        const pendingRemoteByClient = new Map();
        if (!fullAudit) {
            const pendingClientIds = savedRoutes.filter(route => !route.remoteId)
                .map(route => Number(route.id)).filter(Number.isSafeInteger);
            for (let offset = 0; offset < pendingClientIds.length; offset += 50) {
                const ids = pendingClientIds.slice(offset, offset + 50);
                const filter = encodeURIComponent(`(${ids.map(id => `clientId = ${id}`).join(' || ')})`);
                try {
                    const result = await syncCloudApi(`/api/collections/routes/records?filter=${filter}&perPage=200`);
                    if (!isCurrentSync()) return;
                    (result.items || []).forEach(record => pendingRemoteByClient.set(Number(record.clientId), record));
                } catch (error) {
                    if (!isCurrentSync()) return;
                    // No impide subir rutas nuevas; el índice único owner/clientId protege frente a duplicados.
                    markSyncError(error);
                    console.warn('No se pudieron buscar rutas locales pendientes por clientId:', error);
                }
            }
        }

        const nickname = String(Cloud.nickname || '').trim().slice(0, ROUTE_NICKNAME_LIMIT);

        // 2) borrados pendientes
        let pend = [];
        let pendingDeletesAvailable = true;
        try {
            pend = (await DB.kvGet('pendingDeletes')) || [];
            if (!isCurrentSync()) return;
        } catch (e) {
            if (!isCurrentSync()) return;
            pendingDeletesAvailable = false;
            noteSyncFailure(`No se pudo leer la cola de borrados: ${e.message}`);
            console.warn('No se pudo leer la cola de borrados:', e);
        }
        const rest = [];
        for (const rid of pend) {
            if (!isCurrentSync()) return;
            try { await syncCloudApi(`/api/collections/routes/records/${rid}`, 'DELETE'); }
            catch (e) {
                if (!isCurrentSync()) return;
                if (e.status !== 404) {
                    rest.push(rid);
                    noteSyncFailure(`No se pudo borrar una ruta del servidor: ${e.message}`, e);
                    console.warn(`No se pudo borrar la ruta remota ${rid}:`, e);
                }
            }
            if (!isCurrentSync()) return;
        }
        if (pendingDeletesAvailable) {
            if (!isCurrentSync()) return;
            try {
                await DB.kvSet('pendingDeletes', rest);
                if (!isCurrentSync()) return;
            } catch (e) {
                if (!isCurrentSync()) return;
                noteSyncFailure(`No se pudo guardar la cola de borrados: ${e.message}`);
                console.warn('No se pudo guardar la cola de borrados:', e);
            }
        }
        const skip = new Set(pend);

        // 3) reconciliar lo remoto y subir cambios locales sin bloquear otras rutas
        const byClient = new Map(remote.map(x => [Number(x.clientId), x]));
        const byRemoteId = new Map(remote.map(x => [x.id, x]));
        const blockedIds = new Set();
        for (const r of [...savedRoutes]) {
            if (!isCurrentSync()) return;
            const previousCreator = r.createdBy || '';
            r.createdBy = nickname;
            const found = byClient.get(r.id);
            const remoteRecord = r.remoteId && !skip.has(r.remoteId) ? byRemoteId.get(r.remoteId) : null;
            const matched = remoteRecord || (found && !skip.has(found.id) ? found : null)
                || (!fullAudit ? pendingRemoteByClient.get(Number(r.id)) : null);

            // Una ruta borrada desde otro dispositivo ya no existe en el inventario remoto.
            if (r.remoteId && (skip.has(r.remoteId) || (fullAudit && !matched))) {
                try {
                    const ownerId = r.kind === 'recorded' ? (r.groupRankingOwnerId || Cloud.uid) : '';
                    const rankingServer = r.groupRankingServer || retryServer;
                    const clientId = Number(r.id);
                    const rankingDelete = ownerId && rankingServer && Number.isSafeInteger(clientId) && clientId > 0
                        ? { ownerId, server: rankingServer, clientId }
                        : null;
                    if (!isCurrentSync()) return;
                    await DB.deleteRoute(r.id, null, rankingDelete);
                    savedRoutes = savedRoutes.filter(x => x.id !== r.id);
                    garageUsageChanged = true;
                    if (!isCurrentSync()) {
                        renderSavedRoutes();
                        refreshStats();
                        return;
                    }
                    if (rankingDelete) {
                        if (!isCurrentSync()) return;
                        await syncPendingGroupRankingDeletes({
                            server: retryServer,
                            uid: retryUid,
                            api: syncCloudApi,
                            isCurrent: isCurrentSync
                        });
                        if (!isCurrentSync()) return;
                    }
                } catch (e) {
                    if (!isCurrentSync()) return;
                    blockedIds.add(r.id);
                    noteSyncFailure(`No se pudo aplicar el cambio remoto a «${r.name || 'ruta'}»: ${e.message}`);
                    console.warn(`No se pudo aplicar el borrado remoto de la ruta ${r.id}:`, e);
                }
                continue;
            }

            if (matched && !r.dirty) {
                const remoteIdChanged = r.remoteId !== matched.id;
                r.remoteId = matched.id;
                const remoteName = matched.name || r.name;
                const remoteActivity = activityTypeFromName(remoteName) || r.activityType || 'mtb';
                const remoteCreator = nickname;
                if (remoteCreator && matched.createdBy !== remoteCreator) {
                    try {
                        await syncCloudApi(`/api/collections/routes/records/${r.remoteId}`, 'PATCH', { createdBy: remoteCreator });
                        if (!isCurrentSync()) return;
                        matched.createdBy = remoteCreator;
                    } catch (e) {
                        if (!isCurrentSync()) return;
                        noteSyncFailure(`No se pudo actualizar el apodo de «${r.name || 'ruta'}»: ${e.message}`, e);
                        console.warn(`No se pudo actualizar el apodo de la ruta ${r.id}:`, e);
                    }
                }
                const changed = remoteIdChanged || r.name !== remoteName || r.activityType !== remoteActivity || previousCreator !== remoteCreator;
                r.name = remoteName;
                r.activityType = remoteActivity;
                if (remoteCreator) r.createdBy = remoteCreator;
                r.dirty = false;
                if (changed) {
                    if (!isCurrentSync()) return;
                    try { await putLocal(r); }
                    catch (e) {
                        if (!isCurrentSync()) return;
                        blockedIds.add(r.id);
                        noteSyncFailure(`No se pudo guardar «${r.name || 'ruta'}» en este teléfono: ${e.message}`);
                        console.warn(`No se pudo actualizar localmente la ruta ${r.id}:`, e);
                    }
                    if (!isCurrentSync()) return;
                }
                if (!blockedIds.has(r.id) && Cloud.groupCode && hasPendingGroupRanking(r)) {
                    await syncRouteRanking(r);
                    if (!isCurrentSync()) return;
                }
                continue;
            }
            if (blockedIds.has(r.id)) continue;
            if (matched) r.remoteId = matched.id;
            if (r.remoteId && !r.dirty) {
                if (Cloud.groupCode && hasPendingGroupRanking(r)) {
                    await syncRouteRanking(r);
                    if (!isCurrentSync()) return;
                }
                continue;
            }
            try {
                let rec;
                if (r.remoteId) rec = await syncCloudApi(`/api/collections/routes/records/${r.remoteId}`, 'PATCH', {
                    name: r.name,
                    ...(r.createdBy ? { createdBy: String(r.createdBy).slice(0, ROUTE_NICKNAME_LIMIT) } : {})
                });
                else rec = await syncCloudApi('/api/collections/routes/records', 'POST', routeForm(r), { timeoutMs: 60000 });
                if (!isCurrentSync()) return;
                r.remoteId = rec.id;
                r.dirty = false;
                if (r.kind === 'recorded' && Cloud.groupCode) {
                    await syncRouteRanking(r);
                    if (!isCurrentSync()) return;
                }
                if (!isCurrentSync()) return;
                await putLocal(r);
                if (!isCurrentSync()) return;
                pushed++;
            } catch (e) {
                if (!isCurrentSync()) return;
                noteSyncFailure(`No se pudo sincronizar «${r.name || 'ruta'}»: ${e.message}`, e);
                console.warn(`No se pudo sincronizar la ruta ${r.id}:`, e);
                if (e.status === 404 && r.remoteId) {
                    r.remoteId = null;
                    try {
                        if (!isCurrentSync()) return;
                        await putLocal(r);
                        if (!isCurrentSync()) return;
                    } catch (localError) {
                        if (!isCurrentSync()) return;
                        console.warn(`No se pudo actualizar la ruta local ${r.id}:`, localError);
                    }
                }
            }
        }

        // 4) bajar las que faltan en este móvil
        const localIds = new Set(savedRoutes.map(r => r.id));
        const missing = remote.filter(x => !skip.has(x.id) && x.track && !localIds.has(Number(x.clientId)));
        if (missing.length) {
            const FILE_TOKEN_REFRESH_INTERVAL_MS = 60_000;
            let fileToken = '';
            let fileTokenIssuedAt = 0;
            const refreshFileToken = async () => {
                const result = await syncCloudApi('/api/files/token', 'POST');
                if (!isCurrentSync()) return null;
                if (!result || !result.token) throw new Error('El servidor no devolvió un token de descarga.');
                fileToken = result.token;
                fileTokenIssuedAt = Date.now();
                return fileToken;
            };
            const downloadTrack = async rec => {
                let retriedWithFreshToken = false;
                while (true) {
                    if (!isCurrentSync()) return null;
                    if (!fileToken || Date.now() - fileTokenIssuedAt >= FILE_TOKEN_REFRESH_INTERVAL_MS) {
                        if (!await refreshFileToken()) return null;
                    }
                    const dlController = new AbortController();
                    const dlTimer = setTimeout(() => dlController.abort(), 15000);
                    let res;
                    try {
                        res = await fetch(`${retryServer}/api/files/routes/${rec.id}/${encodeURIComponent(rec.track)}?token=${encodeURIComponent(fileToken)}`, { signal: dlController.signal });
                    } catch (error) {
                        if (error && (error.status === undefined || error.name === 'AbortError')) error.retryable = true;
                        throw error;
                    } finally {
                        clearTimeout(dlTimer);
                    }
                    if (!isCurrentSync()) return null;
                    if (res.ok) return res;
                    if (!retriedWithFreshToken && [401, 403, 404].includes(res.status)) {
                        retriedWithFreshToken = true;
                        if (!await refreshFileToken()) return null;
                        continue;
                    }
                    const error = new Error(`El servidor respondió ${res.status}`);
                    error.status = res.status;
                    error.retryable = isRetryableCloudStatus(res.status);
                    throw error;
                }
            };
            for (const rec of missing) {
                if (!isCurrentSync()) return;
                try {
                    const res = await downloadTrack(rec);
                    if (!isCurrentSync()) return;
                    let trackData;
                    try { trackData = JSON.parse(await res.text()); }
                    catch (_) { throw new Error('El archivo del track no contiene JSON válido'); }
                    if (!isCurrentSync()) return;
                    const points = normalizeRemoteTrack(trackData);
                    if (!points) {
                        const shape = Array.isArray(trackData) ? `array (${trackData.length} elementos)`
                            : trackData && typeof trackData === 'object'
                                ? `objeto (${Object.keys(trackData).slice(0, 6).join(', ') || 'sin campos'})`
                                : typeof trackData;
                        throw new Error(`El formato del track no es compatible: ${shape}`);
                    }
                    const id = Number(rec.clientId);
                    if (!Number.isSafeInteger(id) || id < 0) throw new Error('El identificador de ruta no es válido');
                    const r = {
                        id, remoteId: rec.id, dirty: false,
                        kind: rec.kind || 'recorded', name: rec.name, startedAt: rec.startedAt,
                        createdBy: rec.createdBy || 'Usuario local',
                        activityType: Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, rec.activityType)
                            ? rec.activityType
                            : activityTypeFromName(rec.name),
                        movingTimeSec: rec.movingTimeSec || 0, distanceKm: rec.distanceKm || 0,
                        elevationGain: rec.elevationGain || 0, hrAvg: rec.hrAvg || null, points
                    };
                    if (!isCurrentSync()) return;
                    await putLocal(r);
                    savedRoutes.push(r);
                    pulled++;
                    garageUsageChanged = true;
                    if (!isCurrentSync()) {
                        renderSavedRoutes();
                        refreshStats();
                        return;
                    }
                } catch (e) {
                    if (!isCurrentSync()) return;
                    noteSyncFailure(`No se pudo descargar «${rec.name || 'una ruta'}»: ${e.message}`, e);
                    console.warn(`No se pudo descargar la ruta remota ${rec.id}:`, e);
                }
            }
            savedRoutes.sort((a, b) => b.id - a.id);
        }

        if (!isCurrentSync()) return;
        try {
            localStorage.setItem('mtb_pro_lastsync', String(Date.now()));
            localStorage.setItem('mtb_pro_sync_failures', String(syncFailures));
        } catch (e) {
            console.warn('No se pudo guardar el estado de sincronización de rutas:', e);
        }
        if (syncFailures === 0) {
            try {
                if (remote.length || fullAudit) {
                    localStorage.setItem(cursorKey, newestRemoteUpdate(remote, remote.length ? syncStartedAt : 0));
                }
                if (fullAudit) localStorage.setItem(auditKey, String(Date.now()));
            } catch (e) { console.warn('No se pudo guardar el cursor de sincronización de rutas:', e); }
        }
        renderSavedRoutes();
        refreshStats();
        if (manual) toast(syncFailures
            ? `⚠️ Sincronización parcial: ${pushed} subidas, ${pulled} descargadas y ${syncFailures} pendiente(s). ${syncFailureDetails.join(' · ')}`
            : `✅ Sincronizado: ${pushed} subidas, ${pulled} descargadas`, syncFailures ? 10000 : 3500);
    } catch (e) {
        if (!isCurrentSync()) return;
        markSyncError(e);
        console.warn('Sync:', e);
        if (manual || e.status !== undefined) {
            toast(e.status === undefined ? 'No se pudo conectar con el servidor' : 'Error al sincronizar: ' + e.message, 6000);
        }
    } finally {
        if (garageUsageChanged && typeof garageRoutesChanged === 'function') {
            try {
                if (!garageRoutesChanged(savedRoutes)) {
                    toast('Rutas sincronizadas, pero no se pudo actualizar el mantenimiento preventivo.', 6000);
                }
            } catch (e) {
                console.warn('No se pudo actualizar el mantenimiento preventivo tras sincronizar rutas:', e);
                toast('Rutas sincronizadas, pero no se pudo actualizar el mantenimiento preventivo.', 6000);
            }
        }
        const queued = syncQueued;
        const queuedManual = syncQueuedManual;
        const queuedUid = syncQueuedUid;
        const queuedServer = syncQueuedServer;
        const queuedAuthGeneration = syncQueuedAuthGeneration;
        syncQueued = false;
        syncQueuedManual = false;
        syncQueuedUid = '';
        syncQueuedServer = '';
        syncQueuedAuthGeneration = -1;
        syncing = false;
        renderAccount();
        const sameSession = retryGeneration === cloudSyncRetryGeneration
            && isCurrentSync();
        if (retryableSyncFailure && sameSession && navigator.onLine) {
            scheduleCloudSyncRetry(retryUid, retryServer, retryGeneration);
        } else if (!retryableSyncFailure) {
            cloudSyncRetryDelayMs = CLOUD_SYNC_RETRY_INITIAL_MS;
        }
        const queuedForDifferentSession = queuedUid !== retryUid || queuedServer !== retryServer
            || queuedAuthGeneration !== retryAuthGeneration;
        if (queued && Cloud.loggedIn() && navigator.onLine
            && (queuedManual || queuedForDifferentSession
                || (!retryableSyncFailure && !permanentSyncFailure && syncFailures === 0))) {
            setTimeout(() => {
                if (!Cloud.loggedIn() || Cloud.uid !== queuedUid || Cloud.server !== queuedServer
                    || Cloud.authGeneration !== queuedAuthGeneration) return;
                syncRoutes(queuedManual);
            }, 250);
        }
    }
}

function initSettings() {
    const sound = $('setting-route-sound');
    const vibration = $('setting-route-vibration');
    const voice = $('setting-route-voice');
    const recordingHaptics = $('setting-recording-haptics');
    const mapRotation = $('setting-map-rotation');
    sound.checked = localStorage.getItem('mtb_pro_route_sound') !== '0';
    vibration.checked = localStorage.getItem('mtb_pro_route_vibration') !== '0';
    voice.checked = localStorage.getItem('mtb_pro_route_voice') !== '0';
    recordingHaptics.checked = localStorage.getItem('mtb_pro_recording_haptics') !== '0';
    mapRotationEnabled = localStorage.getItem('mtb_pro_map_rotation') !== '0';
    mapRotation.checked = mapRotationEnabled;
    updateOrientBtn();
    const refreshMapStyle = () => {
        applyMapStyle();
        updateQuickMapStyleButton();
    };
    window.addEventListener('online', refreshMapStyle);
    window.addEventListener('offline', refreshMapStyle);
    sound.addEventListener('change', () => {
        localStorage.setItem('mtb_pro_route_sound', sound.checked ? '1' : '0');
        queueCloudPreferencesSync();
    });
    vibration.addEventListener('change', () => {
        localStorage.setItem('mtb_pro_route_vibration', vibration.checked ? '1' : '0');
        queueCloudPreferencesSync();
    });
    voice.addEventListener('change', () => {
        localStorage.setItem('mtb_pro_route_voice', voice.checked ? '1' : '0');
        queueCloudPreferencesSync();
    });
    recordingHaptics.addEventListener('change', () => {
        localStorage.setItem('mtb_pro_recording_haptics', recordingHaptics.checked ? '1' : '0');
        queueCloudPreferencesSync();
    });
    mapRotation.addEventListener('change', () => setMapRotationMode(mapRotation.checked));
    initRecordingPanelSettings();
    initSensorConnections();
    $('app-version').textContent = `v${APP_VERSION} (build ${APP_BUILD})` + (APP_CONFIG.isProduction ? '' : ` · ${APP_CONFIG.label}`);
}

async function syncWhenOnline() {
    let restoredSession = null;
    if (!Cloud.loggedIn() && !accAuthInFlight) {
        try {
            restoredSession = await Cloud.restoreSession();
            if (restoredSession) {
                renderAccountProfile(restoredSession);
                renderAccount();
            }
        }
        catch (error) {
            if (error.status !== 401) console.warn('No se pudo restaurar la sesión al recuperar conexión:', error);
        }
    }
    if (Cloud.loggedIn()) {
        if (restoredSession) restoreGroup();
        syncCloudPreferences();
        if (syncing) syncRoutes();
        else await syncRoutes();
    }
    syncSharedPois();
}

function initAccount() {
    initAccountAvatar();
    const savedServer = localStorage.getItem('mtb_pro_server');
    try {
        localStorage.setItem('mtb_pro_server', normalizeServer(savedServer || DEFAULT_CLOUD_SERVER));
    } catch (error) {
        console.warn('La dirección de servidor guardada no es válida:', error);
        localStorage.setItem('mtb_pro_server', DEFAULT_CLOUD_SERVER);
        Cloud.clearSession();
        toast('La dirección de servidor guardada no era válida; se ha restaurado el servidor predeterminado.', 6000);
    }
    if (cloudServerWasResetOnLoad) {
        cloudServerWasResetOnLoad = false;
        toast('La dirección de servidor guardada no era válida; se ha restaurado el servidor predeterminado.', 6000);
    }

    const serverInput = $('acc-server');
    if (serverInput) {
        serverInput.value = Cloud.server;
        serverInput.addEventListener('change', async () => {
            const hadSession = Cloud.loggedIn();
            let nextServer;
            try { nextServer = await Cloud.switchServer(serverInput.value); }
            catch (error) {
                console.warn('Dirección de servidor no válida:', error);
                toast(error.message, 6000);
                serverInput.value = Cloud.server;
                return;
            }
            serverInput.value = nextServer;
            if (hadSession) {
                toast('Servidor cambiado: vuelve a iniciar sesión.', 4000);
            }
            renderAccount();
        });
    }

    // El formulario evita recargar la página: Intro y "Entrar" inician sesión.
    $('acc-form').addEventListener('submit', event => {
        event.preventDefault();
        accAuthOnce(false);
    });
    $('acc-register').addEventListener('click', () => accAuthOnce(true));
    $('acc-nickname-save').addEventListener('click', saveAccountNickname);
    $('acc-sync').addEventListener('click', async () => {
        await syncCloudPreferences();
        await syncRoutes(true);
        await restoreGroup();
        const poisSynced = await syncSharedPois(true);
        if (!poisSynced && pendingSharedPoiCount()) {
            toast(`${pendingSharedPoiCount()} punto(s) del mapa siguen pendientes: ${poiSyncPendingMessage()}`, 8000);
        }
    });
    $('acc-logout').addEventListener('click', logoutCloudAccount);
    $('acc-logout-incomplete').addEventListener('click', logoutCloudAccount);
    window.addEventListener('online', syncWhenOnline);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) syncWhenOnline();
    });
    renderAccount();
    Cloud.restoreSession().then(record => {
        if (!record) return;
        renderAccountProfile(record);
        renderAccount();
        syncCloudPreferences();
        syncRoutes();
        restoreGroup();
    }).catch(error => {
        if (error.status !== 401) console.warn('No se pudo restaurar la sesión de PocketBase:', error);
        renderAccount();
    });
}

async function init() {
    renderAccountServer();
    initMap();
    initCharts();
    initMetricPanel();
    setBtnState('idle');
    updateCenterBtn();
    loadSavedFountains();

    try {
        await DB.open();
        savedRoutes = (await DB.all()).sort((a, b) => b.id - a.id);
    } catch (e) {
        console.warn('Sin IndexedDB:', e);
        toast('⚠️ Sin almacenamiento persistente: las rutas se perderán al cerrar la app.', 6000);
    }
    renderSavedRoutes();
    dashboardRender();
    initAccount();
    initSettings();

    // 1) Arrancar GPS y recuperar borrador de inmediato (offline-first, no depende de la red)
    startGps();
    await maybeRestoreDraft();

    // Render the home statistics after the core modules, local routes and any
    // recovered recording draft are ready. A later cloud sync refreshes them again.
    requestAnimationFrame(() => {
        dashboardRender();
        refreshStats();
    });

    // 2) Sincronizaciones con la nube en segundo plano (no bloquean el inicio de la app ni el GPS)
    syncRoutes();
    syncSharedPois();
    restoreGroup();
}

init();

// Service Worker: abre la app sin conexión y guarda las teselas ya vistas
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
