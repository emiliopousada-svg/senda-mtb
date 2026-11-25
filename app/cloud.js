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
    sessionState: 'unknown',
    secureTokenKey: 'pocketbase-session-token',
    secureTokenCache: null,
    secureTokenLoaded: false,
    secureTokenQueue: Promise.resolve(),
    authGeneration: 0,
    profileGeneration: 0,
    emailVerified: false,
    serverSwitchInFlight: false,
    logoutInProgress: false,
    usesSecureTokenStorage() {
        if (typeof MTBNativeApp !== 'undefined'
            && typeof MTBNativeApp.isNativePlatform === 'function') {
            return MTBNativeApp.isNativePlatform();
        }
        if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
            throw new Error('El almacenamiento seguro de la sesión no está disponible.');
        }
        return false;
    },
    enqueueSecureTokenOperation(operation) {
        const result = this.secureTokenQueue.then(operation, operation);
        this.secureTokenQueue = result.then(() => undefined, () => undefined);
        return result;
    },
    getSessionToken() {
        if (!this.usesSecureTokenStorage()) return localStorage.getItem('mtb_pro_token');
        if (this.secureTokenLoaded) return Promise.resolve(this.secureTokenCache);
        return this.enqueueSecureTokenOperation(async () => {
            if (this.secureTokenLoaded) return this.secureTokenCache;
            const token = await MTBNativeApp.getSecureItem(this.secureTokenKey);
            if (token) {
                localStorage.removeItem('mtb_pro_token');
                this.secureTokenCache = token;
                this.secureTokenLoaded = true;
                return token;
            }
            const legacyToken = localStorage.getItem('mtb_pro_token');
            if (!legacyToken) {
                this.secureTokenCache = null;
                this.secureTokenLoaded = true;
                return null;
            }
            await MTBNativeApp.setSecureItem(this.secureTokenKey, legacyToken);
            localStorage.removeItem('mtb_pro_token');
            this.secureTokenCache = legacyToken;
            this.secureTokenLoaded = true;
            return legacyToken;
        });
    },
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
        if (current && current !== normalized) {
            const clearing = this.clearSession();
            if (clearing && typeof clearing.then === 'function') {
                return clearing.then(() => {
                    localStorage.setItem('mtb_pro_server', normalized);
                    return normalized;
                });
            }
        }
        localStorage.setItem('mtb_pro_server', normalized);
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

        if (this.sessionState === 'pending') {
            throw new Error('Espera a que termine la restauración de la sesión antes de cambiar de servidor.');
        }
        const uid = this.uid;
        const generation = this.authGeneration;
        this.serverSwitchInFlight = true;
        try {
            if (this.loggedIn() && typeof stopGroup === 'function') {
                await stopGroup();
            }
            if (this.server !== current || this.uid !== uid || this.authGeneration !== generation) {
                throw new Error('La sesión cambió durante el cambio de servidor. Vuelve a intentarlo.');
            }
            await this.clearSession();
            localStorage.setItem('mtb_pro_server', normalized);
            return normalized;
        } catch (error) {
            if (this.loggedIn() && this.server === current && this.uid === uid
                && this.authGeneration === generation && typeof restoreGroup === 'function') {
                await restoreGroup();
            }
            throw error;
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
    setSession(rec, token, expectedGeneration) {
        const applySession = () => {
            if (expectedGeneration !== undefined && expectedGeneration !== this.authGeneration) return false;
            const isNewSession = !this.sessionActive || this.uid !== rec.id;
            if (!this.sessionActive || this.uid !== rec.id) this.authGeneration++;
            if (this.groupCode !== (rec.groupCode || '')) this.profileGeneration++;
            if (typeof rec.verified === 'boolean') this.emailVerified = rec.verified;
            else if (isNewSession) this.emailVerified = false;
            this.sessionActive = true;
            this.sessionState = 'active';
            localStorage.setItem('mtb_pro_uid', rec.id);
            localStorage.setItem('mtb_pro_avatar_last_uid', rec.id);
            localStorage.setItem('mtb_pro_email', rec.email || '');
            if (rec.nickname) localStorage.setItem('mtb_pro_nickname', String(rec.nickname).trim().slice(0, ROUTE_NICKNAME_LIMIT));
            else localStorage.removeItem('mtb_pro_nickname');
            localStorage.setItem('mtb_pro_group_code', rec.groupCode || '');
            if (typeof renderAccountAvatar === 'function') renderAccountAvatar();
            if (typeof dashboardUpdateGreeting === 'function') dashboardUpdateGreeting();
            if (typeof communityScheduleAutomaticSegmentEffortScan === 'function') {
                communityScheduleAutomaticSegmentEffortScan();
            }
            return true;
        };
        if (typeof token === 'string' && token) {
            if (this.usesSecureTokenStorage()) {
                return this.enqueueSecureTokenOperation(async () => {
                    if (expectedGeneration !== undefined && expectedGeneration !== this.authGeneration) return false;
                    await MTBNativeApp.setSecureItem(this.secureTokenKey, token);
                    localStorage.removeItem('mtb_pro_token');
                    this.secureTokenCache = token;
                    this.secureTokenLoaded = true;
                    return applySession();
                });
            }
            localStorage.setItem('mtb_pro_token', token);
        }
        return applySession();
    },
    async refreshSession() {
        const server = this.server;
        const uid = this.uid;
        const generation = this.authGeneration;
        const profileGeneration = this.profileGeneration;
        if (!this.loggedIn()) return null;

        let result;
        try {
            result = await cloudApi('/api/collections/users/auth-refresh', 'POST');
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
            await this.clearSession();
            return null;
        }
        return await this.setSession(result.record, result.token, generation)
            ? result.record
            : null;
    },
    async restoreSession() {
        if (this.serverSwitchInFlight) return null;
        const server = this.server;
        const generation = this.authGeneration;
        this.sessionState = 'pending';
        try {
            let token = this.getSessionToken();
            if (token && typeof token.then === 'function') token = await token;
            if (generation !== this.authGeneration || server !== this.server) return null;
            if (!token) {
                await this.clearSession();
                return null;
            }
            const result = await cloudApi('/api/collections/users/auth-refresh', 'POST', null, {
                authorization: token,
                server
            });
            if (!result || !result.record || !result.record.id) {
                throw new Error('El servidor no devolvió una sesión válida.');
            }
            if (generation !== this.authGeneration || server !== this.server) return null;
            return await this.setSession(result.record, result.token, generation)
                ? result.record
                : null;
        } catch (error) {
            if (generation !== this.authGeneration || server !== this.server) return null;
            if (error.status === 401) await this.clearSession();
            else this.sessionState = 'unknown';
            throw error;
        }
    },
    clearSession() {
        this.authGeneration++;
        this.sessionActive = false;
        this.sessionState = 'none';
        this.emailVerified = false;
        this.secureTokenCache = null;
        this.secureTokenLoaded = true;
        cancelCloudSyncRetry();
        if (typeof cancelCloudPreferencesSync === 'function') cancelCloudPreferencesSync();
        ['mtb_pro_token', 'mtb_pro_uid', 'mtb_pro_email', 'mtb_pro_nickname', 'mtb_pro_group_code'].forEach(k => localStorage.removeItem(k));
        if (typeof resetAccountProfileCache === 'function') resetAccountProfileCache();
        if (typeof renderAccountAvatar === 'function') renderAccountAvatar();
        if (typeof dashboardUpdateGreeting === 'function') dashboardUpdateGreeting();
        if (typeof refreshRestrictedFeatureAccess === 'function') refreshRestrictedFeatureAccess();
        if (this.usesSecureTokenStorage()) {
            return this.enqueueSecureTokenOperation(async () => {
                await MTBNativeApp.removeSecureItem(this.secureTokenKey);
                this.secureTokenCache = null;
                this.secureTokenLoaded = true;
            });
        }
        return null;
    }
};

function requireSignedIn(message) {
    if (Cloud.loggedIn()) return true;
    toast(message || 'Inicia sesión o crea una cuenta para usar esta función.', 5000);
    goToPage(4);
    return false;
}

function refreshRestrictedFeatureAccess() {
    if (typeof communityHandleAccountStateChange === 'function') communityHandleAccountStateChange();
    if (typeof routesHandleAccountStateChange === 'function') routesHandleAccountStateChange();
    if (typeof offlineMapsUpdateAccessState === 'function') offlineMapsUpdateAccessState();
    if (typeof routesUpdateImportAccess === 'function') routesUpdateImportAccess();
}

let cloudServerWasResetOnLoad = false;
try {
    void Cloud.server;
} catch (error) {
    console.warn('La dirección de servidor guardada no es válida:', error);
    localStorage.setItem('mtb_pro_server', DEFAULT_CLOUD_SERVER);
    try {
        const clearing = Cloud.clearSession();
        if (clearing && typeof clearing.catch === 'function') {
            void clearing.catch(clearError => {
                console.error('No se pudo borrar la sesión segura después de corregir el servidor:', clearError);
            });
        }
    } catch (clearError) {
        console.error('No se pudo borrar la sesión segura después de corregir el servidor:', clearError);
    }
    cloudServerWasResetOnLoad = true;
}

const ROUTE_NICKNAME_LIMIT = 32;

let manualAccountSyncInFlight = false;
let accountDeleteInFlight = false;

function renderProfileManualSyncButton() {
    const button = $('profile-manual-sync');
    if (!button) return;
    const syncingNow = manualAccountSyncInFlight;
    const loggedIn = Cloud.loggedIn();
    const hasNickname = Boolean(Cloud.nickname);
    const online = navigator.onLine;
    const canSync = loggedIn && hasNickname && online;
    button.disabled = syncingNow || !canSync;
    const accountSyncButton = $('acc-sync');
    if (accountSyncButton) accountSyncButton.disabled = syncingNow || !canSync;
    button.classList.toggle('is-syncing', syncingNow);
    button.setAttribute('aria-busy', syncingNow ? 'true' : 'false');
    button.setAttribute('aria-label', syncingNow ? 'Sincronizando' : 'Sincronizar ahora');
    button.title = syncingNow ? 'Sincronizando…'
        : !loggedIn ? 'Inicia sesión para sincronizar'
            : !hasNickname ? 'Completa tu apodo para sincronizar'
                : !online ? 'Sin conexión a internet'
                    : 'Sincronizar ahora';
    const label = button.querySelector('.profile-manual-sync-label');
    if (label) label.textContent = syncingNow ? 'Sincronizando…' : 'Sincronizar';
}

async function syncAccountManually() {
    if (manualAccountSyncInFlight) return;
    if (!Cloud.loggedIn()) { toast('Inicia sesión para sincronizar.'); return; }
    if (!Cloud.nickname) { toast('Completa el apodo de tu cuenta antes de sincronizar.'); return; }
    if (!navigator.onLine) { toast('Sin conexión: se sincronizará cuando vuelva internet.'); return; }

    manualAccountSyncInFlight = true;
    renderProfileManualSyncButton();
    try {
        await syncCloudPreferences();
        await syncRoutes(true);
        await restoreGroup();
        const poisSynced = await syncSharedPois(true);
        if (!poisSynced && pendingSharedPoiCount()) {
            toast(`${pendingSharedPoiCount()} punto(s) del mapa siguen pendientes: ${poiSyncPendingMessage()}`, 8000);
        }
    } catch (error) {
        console.warn('No se pudo completar la sincronización manual:', error);
        toast(error.message
            ? `No se pudo completar la sincronización: ${error.message}`
            : 'No se pudo completar la sincronización.', 6000);
    } finally {
        manualAccountSyncInFlight = false;
        renderProfileManualSyncButton();
    }
}

function renderAccount() {
    renderAccountServer();
    const on = Cloud.loggedIn();
    const profileAccountDetails = document.getElementById('profile-account-details');
    if (profileAccountDetails && profileAccountDetailsSessionState !== on) {
        profileAccountDetails.open = !on;
        profileAccountDetailsSessionState = on;
    }
    $('acc-form').style.display = on ? 'none' : 'block';
    $('acc-logged').style.display = on ? 'block' : 'none';
    const hasNickname = Boolean(Cloud.nickname);
    $('acc-nickname-setup').hidden = !on || hasNickname;
    $('acc-ready').hidden = !on || !hasNickname;
    const verificationStatus = $('acc-verification-status');
    if (verificationStatus) verificationStatus.hidden = !on || Cloud.emailVerified;
    if (hasNickname) {
        $('acc-account-nickname').value = Cloud.nickname;
        $('acc-nickname-summary').textContent = `Apodo: ${Cloud.nickname}`;
    }
    const last = localStorage.getItem('mtb_pro_lastsync');
    const syncFailures = Number(localStorage.getItem('mtb_pro_sync_failures') || 0);
    const accountStatus = $('acc-status');
    accountStatus.hidden = !on;
    accountStatus.textContent = on
        ? `Conectado como ${Cloud.email}` + (Cloud.groupCode ? ' · grupo asignado' : ' · sin grupo asignado') + (last ? ` · última sincronización: ${new Date(Number(last)).toLocaleString('es-ES')}` : '') + (syncFailures ? ` · sincronización parcial: ${syncFailures} elemento(s) pendiente(s)` : '')
        : '';
    renderProfileManualSyncButton();
    if (typeof profileUpdateAccountStatus === 'function') profileUpdateAccountStatus();
    if (typeof renderCloudPreferencesStatus === 'function') renderCloudPreferencesStatus();
    if (typeof refreshRestrictedFeatureAccess === 'function') refreshRestrictedFeatureAccess();
}

let profileAccountDetailsSessionState = null;

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
    const homeLocation = typeof profileNormalizeLocation === 'function'
        ? profileNormalizeLocation($('acc-home-location')?.value || '')
        : String($('acc-home-location')?.value || '').trim().slice(0, 80);
    const registrationAvatarFile = register ? $('acc-register-avatar-file')?.files?.[0] : null;
    if (weightKg && (!Number.isFinite(Number(weightKg)) || Number(weightKg) < 25 || Number(weightKg) > 250)) { toast('El peso debe estar entre 25 y 250 kg.'); return; }
    if (heightCm && (!Number.isInteger(Number(heightCm)) || Number(heightCm) < 120 || Number(heightCm) > 230)) { toast('La altura debe estar entre 120 y 230 cm.'); return; }
    if (age && (!Number.isInteger(Number(age)) || Number(age) < 10 || Number(age) > 100)) { toast('La edad debe estar entre 10 y 100 años.'); return; }
    localStorage.setItem('mtb_pro_server', server);
    let verificationRequestError = null;
    try {
        const clearing = Cloud.clearSession();
        if (clearing && typeof clearing.then === 'function') await clearing;
        const authGeneration = Cloud.authGeneration;
        if (register) {
            const profile = { email, password: pass, passwordConfirm: pass, nickname };
            if (weightKg) profile.weightKg = Number(weightKg);
            if (heightCm) profile.heightCm = Number(heightCm);
            if (age) profile.age = Number(age);
            if (homeLocation) profile.homeLocation = homeLocation;
            if (registrationAvatarFile) {
                if (typeof accountAvatarToJpeg !== 'function') throw new Error('No se pudo preparar el avatar.');
                const avatar = await accountAvatarToJpeg(registrationAvatarFile);
                const form = new FormData();
                Object.entries(profile).forEach(([key, value]) => form.append(key, String(value)));
                form.append('avatar', avatar, 'avatar.jpg');
                await cloudApi('/api/collections/users/records', 'POST', form);
            } else {
                await cloudApi('/api/collections/users/records', 'POST', profile);
            }
            try {
                await cloudApi('/api/collections/users/request-verification', 'POST', { email }, { server });
            } catch (error) {
                ensureAuthServer(server, authGeneration);
                verificationRequestError = error;
                console.warn('No se pudo enviar el correo de verificación:', error);
            }
            ensureAuthServer(server, authGeneration);
        }
        const auth = await cloudApi('/api/collections/users/auth-with-password', 'POST', { identity: email, password: pass });
        ensureAuthServer(server, authGeneration);
        if (!auth.token || !auth.record || !auth.record.id) {
            throw new Error('El servidor no devolvió una sesión válida.');
        }
        if (!await Cloud.setSession(auth.record, auth.token, authGeneration)) {
            throw new Error('La sesión cambió durante el inicio de sesión. Vuelve a intentarlo.');
        }
        if (!register && homeLocation && typeof profileSetPendingAccountLocation === 'function') {
            profileSetPendingAccountLocation(auth.record.id, homeLocation);
        }
        renderAccountProfile(auth.record);
        if ((weightKg || age || heightCm) && typeof statsApplyAccountProfile === 'function') {
            statsApplyAccountProfile(auth.record.weightKg ?? (weightKg ? Number(weightKg) : undefined),
                auth.record.age ?? (age ? Number(age) : undefined),
                auth.record.heightCm ?? (heightCm ? Number(heightCm) : undefined));
        }
        try { await syncPendingAccountAvatar(auth.record); }
        catch (avatarError) { console.warn('No se pudo sincronizar el avatar pendiente:', avatarError); }
        await syncCloudPreferences();
        $('acc-pass').value = '';
        $('acc-weight').value = '';
        if ($('acc-height')) $('acc-height').value = '';
        $('acc-age').value = '';
        if ($('acc-home-location')) $('acc-home-location').value = '';
        if ($('acc-register-avatar-file')) $('acc-register-avatar-file').value = '';
        renderAccount();
        if (!Cloud.nickname && nickname) $('acc-account-nickname').value = nickname;
        await restoreGroup();
        toast(register
            ? auth.record.verified
                ? '✅ Cuenta creada'
                : verificationRequestError
                    ? 'Cuenta creada, pero no se pudo enviar el correo de verificación. Usa «Reenviar correo» o inténtalo más tarde.'
                    : 'Cuenta creada. Confirma tu correo para escribir en la comunidad.'
            : auth.record.verified
                ? '✅ Sesión iniciada'
                : 'Sesión iniciada. Verifica tu correo para participar en la comunidad.');
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

async function resendAccountVerification() {
    const button = $('acc-resend-verification');
    const status = $('acc-verification-message');
    if (!Cloud.loggedIn() || Cloud.emailVerified || !button || !status) return;
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const isCurrent = () => Cloud.server === server && Cloud.uid === uid
        && Cloud.authGeneration === generation && Cloud.loggedIn();
    button.disabled = true;
    status.textContent = 'Enviando el correo de verificación…';
    try {
        await cloudApi('/api/collections/users/request-verification', 'POST', { email: Cloud.email }, { server });
        if (!isCurrent()) return;
        status.textContent = 'Correo enviado. Revisa también la carpeta de spam.';
    } catch (error) {
        if (!isCurrent()) return;
        console.warn('No se pudo reenviar el correo de verificación:', error);
        status.textContent = 'No se pudo enviar el correo: ' + (error.message || 'error del servidor.');
    } finally {
        button.disabled = false;
    }
}

async function refreshAccountVerification() {
    const status = $('acc-verification-message');
    const button = $('acc-check-verification');
    if (!Cloud.loggedIn() || !status || !button) return;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    button.disabled = true;
    try {
        const record = await Cloud.refreshSession();
        if (!record || Cloud.uid !== uid || Cloud.authGeneration !== generation) return;
        renderAccount();
        if (Cloud.emailVerified) {
            toast('Correo verificado. Ya puedes participar en la comunidad.');
        } else {
            status.textContent = 'Aún no consta la verificación. Abre el enlace del correo y vuelve a comprobarlo.';
        }
    } catch (error) {
        if (Cloud.uid !== uid || Cloud.authGeneration !== generation) return;
        console.warn('No se pudo comprobar la verificación del correo:', error);
        status.textContent = 'No se pudo comprobar el estado: ' + (error.message || 'error del servidor.');
    } finally {
        button.disabled = false;
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
        Cloud.invalidateProfileReads();
        localStorage.setItem('mtb_pro_nickname', String(updated.nickname || nickname).trim().slice(0, ROUTE_NICKNAME_LIMIT));
        renderAccount();
        toast('Apodo guardado en tu cuenta.');
        syncRoutes();
        syncSharedPois();
        if (typeof communityScheduleAutomaticSegmentEffortScan === 'function') {
            communityScheduleAutomaticSegmentEffortScan();
        }
    } catch (error) {
        if (error.status === 401 && isCurrent()) {
            try { await Cloud.clearSession(); }
            catch (clearError) {
                console.error('No se pudo borrar la sesión segura al caducar:', clearError);
                toast('No se pudo borrar la sesión segura. Cierra la app y vuelve a intentarlo.', 6000);
            }
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
    const sameAuthContext = () => Cloud.server === server && Cloud.uid === uid
        && Cloud.authGeneration === generation;
    try {
        await stopGroup();
        if (!sameAuthContext()) return;
        try { await Cloud.clearSession(); }
        catch (error) {
            console.error('No se pudo borrar la sesión segura al cerrar sesión:', error);
            toast('No se pudo completar el cierre de sesión: ' + error.message, 6000);
            throw error;
        }
        renderFriends();
        renderAccount();
        toast('Sesión cerrada. Tus rutas siguen en este móvil.');
    } finally {
        logoutInFlight = false;
        Cloud.logoutInProgress = false;
    }
}

function toggleAccountDeleteForm(show) {
    const form = $('acc-delete-form');
    const toggle = $('acc-delete-toggle');
    form.hidden = !show;
    toggle.setAttribute('aria-expanded', String(show));
    $('acc-delete-password').value = '';
    if (show) {
        $('acc-delete-status').textContent = '';
        $('acc-delete-password').focus();
    }
}

async function deleteCloudAccount(event) {
    event.preventDefault();
    if (accountDeleteInFlight || logoutInFlight || Cloud.serverSwitchInFlight) return;
    if (!Cloud.loggedIn()) {
        toast('Inicia sesión para eliminar tu cuenta.');
        return;
    }
    if (!navigator.onLine) {
        toast('Conéctate a internet para eliminar tu cuenta.');
        return;
    }
    if (manualAccountSyncInFlight || accAuthInFlight) {
        toast('Espera a que termine la operación de cuenta actual.');
        return;
    }

    const passwordInput = $('acc-delete-password');
    const status = $('acc-delete-status');
    const password = passwordInput.value;
    if (!password) {
        passwordInput.focus();
        status.textContent = 'Escribe tu contraseña actual.';
        return;
    }
    if (!confirm('¿Eliminar permanentemente la cuenta y sus datos sincronizados? Los datos guardados solo en este dispositivo, incluidas rutas y estadísticas, se conservarán.')) {
        return;
    }

    accountDeleteInFlight = true;
    logoutInFlight = true;
    Cloud.logoutInProgress = true;
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const isCurrent = () => Cloud.server === server && Cloud.uid === uid
        && Cloud.authGeneration === generation;
    const submit = $('acc-delete-submit');
    submit.disabled = true;
    status.textContent = 'Eliminando la cuenta…';

    try {
        await cloudApi('/api/mtb/account/delete', 'POST', { password }, { server });
        if (!isCurrent()) return;

        const cleanupErrors = [];
        try {
            if (typeof clearDeletedAccountAvatar === 'function') clearDeletedAccountAvatar(uid);
        } catch (error) {
            cleanupErrors.push(error);
            console.error('La cuenta se eliminó, pero no se pudo borrar el avatar local:', error);
        }
        try {
            const clearing = Cloud.clearSession();
            if (clearing && typeof clearing.then === 'function') await clearing;
        } catch (error) {
            cleanupErrors.push(error);
            console.error('La cuenta se eliminó, pero no se pudo borrar el token local:', error);
        }
        try {
            await stopGroup();
        } catch (error) {
            cleanupErrors.push(error);
            console.warn('La cuenta se eliminó, pero no se pudo limpiar el estado local del grupo:', error);
        }

        passwordInput.value = '';
        toggleAccountDeleteForm(false);
        renderFriends();
        renderAccount();
        if (cleanupErrors.length) {
            toast('La cuenta se eliminó, pero hubo un problema al limpiar datos locales: ' + cleanupErrors.map(error => error.message).join('; '), 7000);
        } else {
            toast('Cuenta eliminada. Tus rutas y estadísticas locales siguen en este dispositivo.');
        }
    } catch (error) {
        if (isCurrent()) {
            passwordInput.value = '';
            status.textContent = error.message || 'No se pudo eliminar la cuenta.';
            toast('No se pudo eliminar la cuenta: ' + status.textContent, 7000);
        }
    } finally {
        accountDeleteInFlight = false;
        logoutInFlight = false;
        Cloud.logoutInProgress = false;
        if (isCurrent()) submit.disabled = false;
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
    if (!Cloud.loggedIn() && !accAuthInFlight && !Cloud.serverSwitchInFlight) {
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
        try {
            const clearing = Cloud.clearSession();
            if (clearing && typeof clearing.catch === 'function') {
                void clearing.catch(clearError => {
                    console.error('No se pudo borrar la sesión segura después de corregir el servidor:', clearError);
                });
            }
        } catch (clearError) {
            console.error('No se pudo borrar la sesión segura después de corregir el servidor:', clearError);
        }
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
            dashboardSetServerStatus('checking');
            void dashboardCheckServerStatus();
        });
    }

    // El formulario evita recargar la página: Intro y "Entrar" inician sesión.
    $('acc-form').addEventListener('submit', event => {
        event.preventDefault();
        accAuthOnce(false);
    });
    $('acc-register').addEventListener('click', () => accAuthOnce(true));
    $('acc-resend-verification').addEventListener('click', resendAccountVerification);
    $('acc-check-verification').addEventListener('click', refreshAccountVerification);
    $('acc-nickname-save').addEventListener('click', saveAccountNickname);
    $('acc-sync').addEventListener('click', syncAccountManually);
    $('profile-manual-sync').addEventListener('click', syncAccountManually);
    $('acc-logout').addEventListener('click', logoutCloudAccount);
    $('acc-logout-incomplete').addEventListener('click', logoutCloudAccount);
    $('acc-delete-toggle').addEventListener('click', () => {
        const form = $('acc-delete-form');
        toggleAccountDeleteForm(form.hidden);
    });
    $('acc-delete-form').addEventListener('submit', deleteCloudAccount);
    $('acc-delete-cancel').addEventListener('click', () => toggleAccountDeleteForm(false));
    window.addEventListener('online', syncWhenOnline);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) syncWhenOnline();
    });
    renderAccount();
    dashboardStartServerStatusUpdates();
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
        if (typeof communityScheduleAutomaticSegmentEffortScan === 'function') {
            communityScheduleAutomaticSegmentEffortScan();
        }
        try { await DB.purgeExpiredTrashedRoutes(); }
        catch (error) {
            console.warn('No se pudieron purgar las rutas caducadas de la papelera:', error);
            toast('No se pudieron eliminar las rutas caducadas de la papelera.', 6000);
        }
        try { await refreshRouteTrash(); }
        catch (error) {
            console.warn('No se pudo cargar la papelera de rutas:', error);
            toast('No se pudo cargar la papelera de rutas.', 6000);
        }
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
