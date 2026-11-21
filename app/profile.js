'use strict';

const PROFILE_LOCATION_KEY = 'mtb_pro_profile_location';
const PROFILE_LOCATION_OWNER_KEY = 'mtb_pro_profile_location_owner';
const PROFILE_LOCATION_USER_PREFIX = 'mtb_pro_profile_location_user_';
const PROFILE_LOCATION_PENDING_PREFIX = 'mtb_pro_profile_location_pending_';
const PROFILE_SETUP_COMPLETE_KEY = 'mtb_pro_profile_setup_complete';
let profileSharedRoutesPromise = null;
let profileSharedRoutesUid = '';
let profileLocationSyncPromise = null;
let profileLocationSyncUid = '';

function profileNormalizeLocation(value) {
    return String(value || '').trim().slice(0, 80);
}

function profileCurrentUid() {
    return typeof Cloud !== 'undefined' && Cloud.uid
        && (!Cloud.loggedIn || Cloud.loggedIn())
        ? String(Cloud.uid)
        : '';
}

function profileLocationUserKey(uid) {
    return `${PROFILE_LOCATION_USER_PREFIX}${encodeURIComponent(uid)}`;
}

function profileLocationPendingKey(uid) {
    return `${PROFILE_LOCATION_PENDING_PREFIX}${encodeURIComponent(uid)}`;
}

function profileStoreCurrentLocation(location) {
    if (location) localStorage.setItem(PROFILE_LOCATION_KEY, location);
    else localStorage.removeItem(PROFILE_LOCATION_KEY);
}

function profileStoreAccountLocation(uid, location) {
    if (location) localStorage.setItem(profileLocationUserKey(uid), location);
    else localStorage.removeItem(profileLocationUserKey(uid));
    profileStoreCurrentLocation(location);
    localStorage.setItem(PROFILE_LOCATION_OWNER_KEY, uid);
}

function profileDisplayLocation(location) {
    profileSetText('profile-location', location || 'Añade tu localidad habitual');
    const input = document.getElementById('profile-location-input');
    if (input && document.activeElement !== input) input.value = location;
}

function profileSetLocationNote(message) {
    const note = document.getElementById('profile-editor-note');
    if (note) note.textContent = message;
}

function profileOpenEditorOnFirstVisit() {
    if (typeof document === 'undefined') return false;
    const editor = document.getElementById('profile-editor');
    if (!editor || localStorage.getItem(PROFILE_SETUP_COMPLETE_KEY) === 'true'
        || profileNormalizeLocation(localStorage.getItem(PROFILE_LOCATION_KEY))) return false;

    editor.hidden = false;
    const editButton = document.getElementById('profile-edit-button');
    if (editButton) editButton.setAttribute('aria-expanded', 'true');
    return true;
}

async function profileSyncPendingLocation(uid) {
    if (!uid || !navigator.onLine || profileCurrentUid() !== uid) return null;
    const pendingKey = profileLocationPendingKey(uid);
    while (true) {
        if (profileCurrentUid() !== uid) return null;
        if (profileLocationSyncPromise && profileLocationSyncUid === uid) {
            await profileLocationSyncPromise;
            if (profileCurrentUid() !== uid) return null;
            continue;
        }
        const pending = localStorage.getItem(pendingKey);
        if (pending === null) return null;

        profileLocationSyncUid = uid;
        const sync = (async () => {
        const location = profileNormalizeLocation(pending);
        const updated = await cloudApi(
            `/api/collections/users/records/${encodeURIComponent(uid)}`,
            'PATCH',
            { homeLocation: location }
        );
        if (!updated || typeof updated !== 'object'
            || !Object.prototype.hasOwnProperty.call(updated, 'homeLocation')
            || profileNormalizeLocation(updated.homeLocation) !== location) {
            throw new Error('El servidor no confirmó la localidad del perfil.');
        }
        if (profileCurrentUid() !== uid || localStorage.getItem(pendingKey) !== pending) return null;
        profileStoreAccountLocation(uid, location);
        localStorage.removeItem(pendingKey);
        if (typeof Cloud.setSession === 'function') {
            Cloud.setSession({ ...updated, groupCode: Cloud.groupCode });
        }
        profileDisplayLocation(location);
        profileSetLocationNote('Localidad sincronizada con tu cuenta; no se publica automáticamente.');
        return updated;
        })();
        profileLocationSyncPromise = sync;
        try {
            const updated = await sync;
            if (updated) return updated;
        } finally {
            if (profileLocationSyncPromise === sync) {
                profileLocationSyncPromise = null;
                profileLocationSyncUid = '';
            }
        }
    }
}

function profileStartLocationSync(uid) {
    profileSyncPendingLocation(uid).then(updated => {
        if (updated) toast('Localidad habitual guardada en tu cuenta.');
    }).catch(error => {
        console.warn('La localidad del perfil sigue pendiente de sincronización:', error);
        profileSetLocationNote(`No se pudo sincronizar; queda pendiente: ${error.message}`);
        toast('La localidad sigue guardada en este dispositivo y se reintentará al conectar.');
    });
}

function profileApplyAccountLocation(record) {
    const uid = profileCurrentUid();
    if (!uid || !record) return;
    try {
        const pending = localStorage.getItem(profileLocationPendingKey(uid));
        if (pending !== null) {
            const pendingLocation = profileNormalizeLocation(pending);
            profileStoreCurrentLocation(pendingLocation);
            localStorage.setItem(PROFILE_LOCATION_OWNER_KEY, uid);
            profileDisplayLocation(pendingLocation);
            profileSetLocationNote('Localidad guardada en este dispositivo; sincronizando con tu cuenta.');
            if (navigator.onLine) profileStartLocationSync(uid);
            return;
        }

        const hasRemoteLocation = Object.prototype.hasOwnProperty.call(record, 'homeLocation');
        const remoteLocation = hasRemoteLocation ? profileNormalizeLocation(record.homeLocation) : '';
        if (remoteLocation) {
            profileStoreAccountLocation(uid, remoteLocation);
            profileDisplayLocation(remoteLocation);
            profileSetLocationNote('Localidad guardada en tu cuenta; no se publica automáticamente.');
            return;
        }

        const owner = localStorage.getItem(PROFILE_LOCATION_OWNER_KEY) || '';
        const localLocation = profileNormalizeLocation(localStorage.getItem(PROFILE_LOCATION_KEY));
        const accountLocation = localStorage.getItem(profileLocationUserKey(uid));
        if (hasRemoteLocation && (owner === uid || accountLocation !== null)) {
            profileStoreAccountLocation(uid, '');
            profileDisplayLocation('');
            profileSetLocationNote('Se guarda en tu cuenta al guardar; no se publica automáticamente.');
            return;
        }
        if (!hasRemoteLocation && accountLocation !== null) {
            const cached = profileNormalizeLocation(accountLocation);
            profileStoreAccountLocation(uid, cached);
            profileDisplayLocation(cached);
            profileSetLocationNote('Localidad guardada en tu cuenta; no se publica automáticamente.');
            return;
        }
        if ((!owner || owner === uid) && localLocation) {
            localStorage.setItem(profileLocationPendingKey(uid), localLocation);
            profileDisplayLocation(localLocation);
            profileSetLocationNote('Asociando a tu cuenta la localidad que ya estaba guardada en este dispositivo.');
            if (navigator.onLine) profileStartLocationSync(uid);
            return;
        }

        profileStoreAccountLocation(uid, '');
        profileDisplayLocation('');
        profileSetLocationNote('Se guarda en tu cuenta al guardar; no se publica automáticamente.');
    } catch (error) {
        console.warn('No se pudo cargar la localidad de la cuenta:', error);
        profileSetLocationNote('No se pudo cargar la localidad de la cuenta.');
    }
}

function profileBuildBadges(summary = {}) {
    const rideCount = Number(summary.rideCount) || 0;
    const distanceKm = Number(summary.distanceKm) || 0;
    const ascentM = Number(summary.ascentM) || 0;
    const hasAscent = Number(summary.ascentSampleCount) > 0;
    const badges = [];
    if (rideCount >= 1) badges.push({ icon: '🚵', title: 'Primera ruta', detail: 'Primera salida registrada' });
    if (distanceKm >= 100) badges.push({ icon: '📍', title: '100 km', detail: 'Distancia acumulada' });
    if (distanceKm >= 1000) badges.push({ icon: '🏅', title: '1.000 km', detail: 'Distancia acumulada' });
    if (hasAscent && ascentM >= 10000) badges.push({ icon: '⛰', title: '10.000 m+', detail: 'Desnivel positivo' });
    return badges;
}

function profileFormatDuration(seconds) {
    const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
    return `${Math.floor(totalMinutes / 60)} h ${totalMinutes % 60} min`;
}

function profileReadPerformance(storage) {
    const age = Number(storage.getItem('mtb_pro_stats_age'));
    const storedHrMax = Number(storage.getItem('mtb_pro_stats_hr_max'));
    const ftp = Number(storage.getItem('mtb_pro_stats_ftp'));
    const validAge = Number.isFinite(age) && age >= 10 && age <= 100;
    const validHrMax = Number.isFinite(storedHrMax) && storedHrMax >= 100 && storedHrMax <= 240;
    const validFtp = Number.isFinite(ftp) && ftp >= 50 && ftp <= 800;
    return {
        heartRateMax: validAge ? 220 - age : validHrMax ? storedHrMax : null,
        ftp: validFtp ? ftp : null
    };
}

function profileSetText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function profileSafeImageSource(value) {
    const source = String(value || '');
    return /^data:image\/(?:jpeg|png|webp);base64,/i.test(source) ? source : '';
}

function profileRender() {
    if (typeof document === 'undefined') return null;

    const nickname = typeof Cloud !== 'undefined' && Cloud.nickname
        ? Cloud.nickname
        : localStorage.getItem('mtb_pro_nickname');
    profileSetText('profile-name', String(nickname || '').trim() || 'Biker');

    const avatar = profileSafeImageSource(typeof getAccountAvatarUrl === 'function' ? getAccountAvatarUrl() : '');
    const avatarImage = document.getElementById('profile-avatar-image');
    const avatarPlaceholder = document.getElementById('profile-avatar-placeholder');
    if (avatarImage && avatarPlaceholder) {
        avatarImage.hidden = !avatar;
        avatarPlaceholder.hidden = Boolean(avatar);
        if (avatar) avatarImage.src = avatar;
        else avatarImage.removeAttribute('src');
    }

    const location = profileNormalizeLocation(localStorage.getItem(PROFILE_LOCATION_KEY));
    profileDisplayLocation(location);

    const routes = Array.isArray(savedRoutes) ? savedRoutes : [];
    const rides = statsRangeRides('all', routes);
    const summary = statsAggregate(rides.map(statsAnalyzeRoute));
    profileSetText('profile-total-distance', `${summary.distanceKm.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`);
    profileSetText('profile-total-ascent', summary.ascentSampleCount ? `+${Math.round(summary.ascentM).toLocaleString('es-ES')} m` : '—');
    profileSetText('profile-total-time', profileFormatDuration(summary.movingTimeSec));
    profileSetText('profile-ride-count', `${summary.rideCount} ${summary.rideCount === 1 ? 'salida' : 'salidas'} registradas`);

    const bikeState = typeof garageState === 'undefined' ? null : garageState;
    const bikeSummary = bikeState && typeof garageSummary === 'function'
        ? garageSummary(bikeState, routes)
        : { totalKm: 0 };
    const bikeName = bikeState && bikeState.bikeName ? bikeState.bikeName : 'Añade tu bicicleta en Garaje';
    const bikePhoto = profileSafeImageSource(
        bikeState && typeof GARAGE_PHOTO_KEY !== 'undefined' ? localStorage.getItem(GARAGE_PHOTO_KEY) : ''
    );
    const bikeImage = document.getElementById('profile-bike-image');
    const bikePlaceholder = document.getElementById('profile-bike-placeholder');
    if (bikeImage && bikePlaceholder) {
        bikeImage.hidden = !bikePhoto;
        bikePlaceholder.hidden = Boolean(bikePhoto);
        if (bikePhoto) bikeImage.src = bikePhoto;
        else bikeImage.removeAttribute('src');
    }
    profileSetText('profile-bike-name', bikeName);
    profileSetText('profile-bike-distance', `${garageFormatKm(bikeSummary.totalKm)} km`);

    const badges = profileBuildBadges(summary);
    const badgeList = document.getElementById('profile-achievements');
    if (badgeList) {
        badgeList.replaceChildren(...badges.map(badge => {
            const item = document.createElement('article');
            item.className = 'profile-badge';
            const icon = document.createElement('span');
            icon.className = 'profile-badge-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = badge.icon;
            const copy = document.createElement('span');
            copy.className = 'profile-badge-copy';
            const title = document.createElement('strong');
            title.textContent = badge.title;
            const detail = document.createElement('small');
            detail.textContent = badge.detail;
            copy.append(title, detail);
            item.append(icon, copy);
            return item;
        }));
    }
    profileSetText('profile-achievement-count', String(badges.length));
    const emptyAchievements = document.getElementById('profile-achievements-empty');
    if (emptyAchievements) emptyAchievements.hidden = badges.length > 0;

    const performance = profileReadPerformance(localStorage);
    profileSetText('profile-hr-max', performance.heartRateMax ? `${performance.heartRateMax} lpm` : 'Sin configurar');
    profileSetText('profile-ftp', performance.ftp ? `${performance.ftp} W` : 'Sin configurar');
    return summary;
}

async function profileRefreshSharedRoutes() {
    const count = document.getElementById('profile-shared-routes-count');
    const note = document.getElementById('profile-shared-routes-note');
    if (!count) return;

    if (typeof Cloud === 'undefined' || !Cloud.loggedIn() || !navigator.onLine) {
        count.textContent = '—';
        count.setAttribute('aria-label', 'Rutas compartidas no disponibles');
        if (note) note.textContent = typeof Cloud !== 'undefined' && Cloud.loggedIn()
            ? 'Conéctate para consultar tus rutas publicadas.'
            : 'Inicia sesión para consultar tus rutas publicadas.';
        return;
    }

    const uid = String(Cloud.uid || '');
    if (profileSharedRoutesPromise && profileSharedRoutesUid === uid) return profileSharedRoutesPromise;

    profileSharedRoutesUid = uid;
    count.textContent = '…';
    count.setAttribute('aria-label', 'Cargando rutas compartidas');
    if (note) note.textContent = 'Consultando las rutas publicadas en la comunidad…';
    profileSharedRoutesPromise = (async () => {
        try {
            const safeUid = uid.replace(/["\\]/g, '');
            const filter = `owner = "${safeUid}" && published = true`;
            const result = await cloudApi('/api/collections/community_routes/records?page=1&perPage=1&fields=id&filter='
                + encodeURIComponent(filter));
            const total = Number(result && result.totalItems);
            if (Cloud.uid !== uid) return;
            if (!Number.isSafeInteger(total) || total < 0) throw new Error('El servidor no devolvió un total válido de rutas publicadas.');
            count.textContent = String(total);
            count.setAttribute('aria-label', `${total} ${total === 1 ? 'ruta compartida' : 'rutas compartidas'}`);
            if (note) note.textContent = 'Rutas publicadas por tu cuenta en la comunidad.';
        } catch (error) {
            console.warn('No se pudo consultar el total de rutas compartidas:', error);
            if (Cloud.uid === uid) {
                count.textContent = '—';
                count.setAttribute('aria-label', 'Rutas compartidas no disponibles');
                if (note) note.textContent = 'No se pudo consultar el total de rutas publicadas.';
            }
        } finally {
            if (profileSharedRoutesUid === uid) profileSharedRoutesPromise = null;
        }
    })();
    return profileSharedRoutesPromise;
}

function profileBindUI() {
    const editButton = document.getElementById('profile-edit-button');
    const editor = document.getElementById('profile-editor');
    const locationInput = document.getElementById('profile-location-input');
    if (editButton && editor) {
        editButton.addEventListener('click', () => {
            const open = editor.hidden;
            editor.hidden = !open;
            editButton.setAttribute('aria-expanded', String(open));
            if (!open) localStorage.setItem(PROFILE_SETUP_COMPLETE_KEY, 'true');
            if (open && locationInput) locationInput.focus();
        });
    }

    editor?.addEventListener('submit', async event => {
        event.preventDefault();
        const location = profileNormalizeLocation(locationInput ? locationInput.value : '');
        const uid = profileCurrentUid();
        try {
            profileStoreCurrentLocation(location);
            localStorage.setItem(PROFILE_SETUP_COMPLETE_KEY, 'true');
            if (uid) {
                localStorage.setItem(profileLocationUserKey(uid), location);
                localStorage.setItem(PROFILE_LOCATION_OWNER_KEY, uid);
                localStorage.setItem(profileLocationPendingKey(uid), location);
            } else {
                localStorage.setItem(PROFILE_LOCATION_OWNER_KEY, '');
            }
        } catch (error) {
            console.warn('No se pudo guardar la localidad del perfil:', error);
            toast('No se pudo guardar la ubicación en este dispositivo.');
            return;
        }
        profileRender();
        editor.hidden = true;
        if (editButton) editButton.setAttribute('aria-expanded', 'false');
        if (!uid) {
            profileSetLocationNote('Guardada en este dispositivo. Inicia sesión para asociarla a tu cuenta; no se publica.');
            toast('Localidad guardada en este dispositivo.');
            return;
        }
        if (!navigator.onLine) {
            profileSetLocationNote('Guardada en este dispositivo; se sincronizará cuando vuelva la conexión.');
            toast('Localidad guardada en este dispositivo; pendiente de sincronización.');
            return;
        }
        const saveButton = editor.querySelector('button[type="submit"]');
        if (saveButton) saveButton.disabled = true;
        try {
            await profileSyncPendingLocation(uid);
            toast('Localidad habitual guardada en tu cuenta.');
        } catch (error) {
            console.warn('La localidad se guardó localmente, pero no se pudo sincronizar:', error);
            profileSetLocationNote(`No se pudo sincronizar; queda pendiente: ${error.message}`);
            toast('La localidad sigue guardada en este dispositivo y se reintentará al conectar.');
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    });

    document.getElementById('profile-account-edit')?.addEventListener('click', () => {
        const accountDetails = document.getElementById('profile-account-details');
        if (accountDetails) accountDetails.open = true;
        const accountOptions = document.querySelector('#acc-ready details.account-options');
        if (accountOptions) accountOptions.open = true;
        document.getElementById('acc-profile-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    document.getElementById('profile-open-garage')?.addEventListener('click', () => {
        if (typeof goToPage === 'function') goToPage(7);
        if (typeof garageOpenWorkspace === 'function') garageOpenWorkspace();
    });
}

if (typeof document !== 'undefined') profileBindUI();
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        const uid = profileCurrentUid();
        if (uid) profileStartLocationSync(uid);
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        profileBuildBadges,
        profileFormatDuration,
        profileNormalizeLocation,
        profileReadPerformance
    };
}
