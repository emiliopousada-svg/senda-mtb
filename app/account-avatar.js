'use strict';

const ACCOUNT_AVATAR_MAX_BYTES = 256 * 1024;
const ACCOUNT_AVATAR_MAX_INPUT_BYTES = 20 * 1024 * 1024;
const ACCOUNT_AVATAR_FETCH_TIMEOUT_MS = 10000;
const ACCOUNT_AVATAR_DEFAULT_URL = 'icon-512.png';
const ACCOUNT_AVATAR_CACHE_PREFIX = 'mtb_pro_avatar_';
const ACCOUNT_AVATAR_PENDING_PREFIX = 'mtb_pro_avatar_pending_';
const ACCOUNT_AVATAR_REMOTE_PREFIX = 'mtb_pro_avatar_remote_';
let accountAvatarPreviewUrl = '';
let accountProfileSnapshot = { uid: '', weightKg: undefined, heightCm: undefined, age: undefined };
let accountAvatarSyncQueue = Promise.resolve();
const accountAvatarUploadGenerations = new Map();

function accountAvatarKey(uid) { return `${ACCOUNT_AVATAR_CACHE_PREFIX}${uid}`; }
function accountAvatarPendingKey(uid) { return `${ACCOUNT_AVATAR_PENDING_PREFIX}${uid}`; }
function accountAvatarDefaultUrl() { return ACCOUNT_AVATAR_DEFAULT_URL; }
function resetAccountProfileCache() { accountProfileSnapshot = { uid: '', weightKg: undefined, heightCm: undefined, age: undefined }; }

function clearDeletedAccountAvatar(uid) {
    if (!uid) return;
    [
        accountAvatarKey(uid),
        accountAvatarPendingKey(uid),
        `${ACCOUNT_AVATAR_REMOTE_PREFIX}${uid}`
    ].forEach(key => localStorage.removeItem(key));
    if (localStorage.getItem('mtb_pro_avatar_last_uid') === uid) {
        localStorage.removeItem('mtb_pro_avatar_last_uid');
    }
    resetAccountProfileCache();
    renderAccountAvatar();
}

function hasPendingLocalAccountAvatar(uid) {
    const pendingValue = localStorage.getItem(accountAvatarPendingKey(uid));
    if (!pendingValue) return false;
    try {
        const pending = JSON.parse(pendingValue);
        return !!(pending && typeof pending === 'object' && pending.avatar);
    } catch (_) { return true; }
}

function getAccountAvatarUrl() {
    // Puede llamarse desde el saludo de inicio antes de que cloud.js defina Cloud.
    const sessionUid = typeof Cloud !== 'undefined' ? Cloud.uid : localStorage.getItem('mtb_pro_uid');
    const uid = sessionUid || localStorage.getItem('mtb_pro_avatar_last_uid') || '';
    if (!uid) return accountAvatarDefaultUrl();
    try { return localStorage.getItem(accountAvatarKey(uid)) || accountAvatarDefaultUrl(); }
    catch (error) { return accountAvatarDefaultUrl(); }
}

function renderAccountAvatar() {
    const image = $('acc-avatar-image');
    const placeholder = $('acc-avatar-placeholder');
    if (image && placeholder) {
        const src = getAccountAvatarUrl();
        image.src = src || '';
        image.hidden = !src;
        placeholder.hidden = !!src;
    }
    if (typeof updateGpsAvatarMarkers === 'function') updateGpsAvatarMarkers();
    if (typeof dashboardUpdateGreeting === 'function') dashboardUpdateGreeting();
}

function accountAvatarToJpeg(file) {
    return new Promise((resolve, reject) => {
        if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > ACCOUNT_AVATAR_MAX_INPUT_BYTES) {
            reject(new Error('Elige una imagen JPEG, PNG o WebP de hasta 20 MB.'));
            return;
        }
        createImageBitmap(file).then(image => {
            try {
                const scale = Math.min(1, 512 / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                const context = canvas.getContext('2d');
                if (!context) throw new Error('No se pudo preparar el avatar.');
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                const encode = quality => new Promise((res, rej) => canvas.toBlob(blob => blob ? res(blob) : rej(new Error('No se pudo preparar el avatar.')), 'image/jpeg', quality));
                (async () => {
                    for (const quality of [0.86, 0.72, 0.58, 0.45]) {
                        const blob = await encode(quality);
                        if (blob.size <= ACCOUNT_AVATAR_MAX_BYTES) return blob;
                    }
                    throw new Error('La imagen no se pudo comprimir por debajo de 256 KB.');
                })().then(resolve, reject);
            } catch (error) { reject(error); }
            finally { image.close(); }
        }, reject);
    });
}

function accountAvatarDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('No se pudo guardar el avatar en este teléfono.'));
        reader.readAsDataURL(blob);
    });
}

function syncPendingAccountAvatar(record = null) {
    const uid = Cloud.uid;
    const uploadGeneration = uid ? (accountAvatarUploadGenerations.get(uid) || 0) : 0;
    const sync = accountAvatarSyncQueue.then(() => {
        if (!uid || Cloud.uid !== uid) return;
        return syncPendingAccountAvatarNow(record, uid, uploadGeneration);
    });
    accountAvatarSyncQueue = sync.catch(() => {});
    return sync;
}

async function syncPendingAccountAvatarNow(record = null, uid = Cloud.uid, queuedUploadGeneration = 0) {
    if (!uid || Cloud.uid !== uid || !navigator.onLine) return;
    const key = accountAvatarPendingKey(uid);
    const pendingValue = localStorage.getItem(key);
    if (!pendingValue) {
        if (record && (accountAvatarUploadGenerations.get(uid) || 0) === queuedUploadGeneration) {
            await cacheRemoteAccountAvatar(record);
        }
        return;
    }
    let pending;
    try { pending = JSON.parse(pendingValue); }
    catch (error) { pending = { avatar: pendingValue }; }
    const form = new FormData();
    if (pending.avatar) {
        const blob = await (await fetch(pending.avatar)).blob();
        form.append('avatar', blob, 'avatar.jpg');
    }
    if (Cloud.uid !== uid) return;
    if (pending.weightKg !== undefined && pending.weightKg !== '') form.append('weightKg', pending.weightKg);
    if (pending.heightCm !== undefined && pending.heightCm !== '') form.append('heightCm', pending.heightCm);
    if (pending.age !== undefined && pending.age !== '') form.append('age', pending.age);
    for (const field of pending.clearedFields || []) form.append(field, '0');
    const updated = await cloudApi(`/api/collections/users/records/${encodeURIComponent(uid)}`, 'PATCH', form, { timeoutMs: 60000 });
    // No consumas ni apliques una respuesta antigua si se guardó otro snapshot
    // mientras la petición estaba en curso; el nuevo queda pendiente para reintento.
    if (Cloud.uid !== uid) return;
    accountAvatarUploadGenerations.set(uid, (accountAvatarUploadGenerations.get(uid) || 0) + 1);
    if (localStorage.getItem(key) !== pendingValue) return;
    localStorage.removeItem(key);
    if (updated && updated.avatar) localStorage.setItem(`${ACCOUNT_AVATAR_REMOTE_PREFIX}${uid}`, updated.avatar);
    if (updated) renderAccountProfile(updated, true, pending);
}

function renderAccountProfile(record = {}, force = false, submittedSnapshot = null) {
    const uid = Cloud.uid;
    if (!uid || !record
        || (!Object.prototype.hasOwnProperty.call(record, 'weightKg')
            && !Object.prototype.hasOwnProperty.call(record, 'heightCm')
            && !Object.prototype.hasOwnProperty.call(record, 'age')
            && !Object.prototype.hasOwnProperty.call(record, 'homeLocation'))) return;
    if (typeof profileApplyAccountLocation === 'function') profileApplyAccountLocation(record);
    if (!Object.prototype.hasOwnProperty.call(record, 'weightKg')
        && !Object.prototype.hasOwnProperty.call(record, 'heightCm')
        && !Object.prototype.hasOwnProperty.call(record, 'age')) return;
    const weight = $('acc-profile-weight');
    const height = $('acc-profile-height');
    const age = $('acc-profile-age');
    let pendingProfile = null;
    if (!submittedSnapshot) {
        try {
            const pendingValue = localStorage.getItem(accountAvatarPendingKey(uid));
            const parsedPending = pendingValue ? JSON.parse(pendingValue) : null;
            if (parsedPending && typeof parsedPending === 'object' && !Array.isArray(parsedPending)) pendingProfile = parsedPending;
        } catch (error) {
            if (typeof console !== 'undefined') console.warn('No se pudo leer el perfil pendiente guardado:', error);
        }
    }
    const profileRecord = { ...record };
    const pendingClears = new Set(Array.isArray(pendingProfile?.clearedFields) ? pendingProfile.clearedFields : []);
    ['weightKg', 'heightCm', 'age'].forEach(field => {
        if (pendingClears.has(field)) profileRecord[field] = 0;
        else if (pendingProfile && pendingProfile[field] !== undefined && pendingProfile[field] !== '') profileRecord[field] = pendingProfile[field];
    });
    const sameProfile = accountProfileSnapshot.uid === uid;
    if (!sameProfile) {
        accountProfileSnapshot = { uid, weightKg: undefined, heightCm: undefined, age: undefined };
    }
    const weightKg = Number(profileRecord.weightKg);
    const heightCm = Number(profileRecord.heightCm);
    const ageYears = Number(profileRecord.age);
    const validWeight = profileRecord.weightKg !== null && profileRecord.weightKg !== undefined && Number.isFinite(weightKg) && weightKg >= 25 && weightKg <= 250;
    const validHeight = profileRecord.heightCm !== null && profileRecord.heightCm !== undefined && Number.isInteger(heightCm) && heightCm >= 120 && heightCm <= 230;
    const validAge = profileRecord.age !== null && profileRecord.age !== undefined && Number.isInteger(ageYears) && ageYears >= 10 && ageYears <= 100;
    const nextWeight = validWeight ? String(weightKg) : '';
    const nextHeight = validHeight ? String(heightCm) : '';
    const nextAge = validAge ? String(ageYears) : '';
    const weightDirty = sameProfile && weight && ((accountProfileSnapshot.weightKg !== undefined && weight.value !== accountProfileSnapshot.weightKg)
        || (accountProfileSnapshot.weightKg === undefined && weight.value !== ''));
    const heightDirty = sameProfile && height && ((accountProfileSnapshot.heightCm !== undefined && height.value !== accountProfileSnapshot.heightCm)
        || (accountProfileSnapshot.heightCm === undefined && height.value !== ''));
    const ageDirty = sameProfile && age && ((accountProfileSnapshot.age !== undefined && age.value !== accountProfileSnapshot.age)
        || (accountProfileSnapshot.age === undefined && age.value !== ''));
    const weightUnchangedSinceSubmit = !submittedSnapshot || weight?.value === String(submittedSnapshot.weightKg ?? '');
    const heightUnchangedSinceSubmit = !submittedSnapshot || height?.value === String(submittedSnapshot.heightCm ?? '');
    const ageUnchangedSinceSubmit = !submittedSnapshot || age?.value === String(submittedSnapshot.age ?? '');
    if (weight && document.activeElement !== weight && (force ? weightUnchangedSinceSubmit : !weightDirty)) {
        weight.value = nextWeight;
        accountProfileSnapshot.weightKg = nextWeight;
    } else if (force) accountProfileSnapshot.weightKg = nextWeight;
    if (height && document.activeElement !== height && (force ? heightUnchangedSinceSubmit : !heightDirty)) {
        height.value = nextHeight;
        accountProfileSnapshot.heightCm = nextHeight;
    } else if (force) accountProfileSnapshot.heightCm = nextHeight;
    if (age && document.activeElement !== age && (force ? ageUnchangedSinceSubmit : !ageDirty)) {
        age.value = nextAge;
        accountProfileSnapshot.age = nextAge;
    } else if (force) accountProfileSnapshot.age = nextAge;
    if (typeof statsApplyAccountProfile === 'function') {
        statsApplyAccountProfile(
            (force ? weightUnchangedSinceSubmit : !weightDirty) ? profileRecord.weightKg : undefined,
            (force ? ageUnchangedSinceSubmit : !ageDirty) ? profileRecord.age : undefined,
            (force ? heightUnchangedSinceSubmit : !heightDirty) ? profileRecord.heightCm : undefined
        );
    }
}

async function cacheRemoteAccountAvatar(record) {
    const uid = Cloud.uid;
    if (!uid || !record) return;
    localStorage.setItem('mtb_pro_avatar_last_uid', uid);
    // Conserva la imagen elegida localmente hasta que se confirme su subida.
    if (hasPendingLocalAccountAvatar(uid)) {
        renderAccountAvatar();
        return;
    }
    const remoteName = String(record.avatar || '');
    const remoteKey = `${ACCOUNT_AVATAR_REMOTE_PREFIX}${uid}`;
    if (!remoteName) {
        if (localStorage.getItem(remoteKey)) localStorage.removeItem(accountAvatarKey(uid));
        localStorage.removeItem(remoteKey);
        renderAccountAvatar();
        return;
    }
    if (localStorage.getItem(remoteKey) === remoteName && localStorage.getItem(accountAvatarKey(uid))) return;
    const url = `${Cloud.server}/api/files/users/${encodeURIComponent(uid)}/${encodeURIComponent(remoteName)}?thumb=256x256`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ACCOUNT_AVATAR_FETCH_TIMEOUT_MS);
    let blob;
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            const error = new Error('No se pudo descargar el avatar de la cuenta.');
            error.status = response.status;
            error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
            throw error;
        }
        blob = await response.blob();
    } catch (error) {
        if (error.name === 'AbortError' || error.status === undefined) error.retryable = true;
        throw error;
    } finally {
        clearTimeout(timer);
    }
    if (!blob.type.startsWith('image/')) throw new Error('El servidor devolvió un archivo de avatar no válido.');
    const dataUrl = await accountAvatarDataUrl(blob);
    if (Cloud.uid !== uid || hasPendingLocalAccountAvatar(uid)) {
        renderAccountAvatar();
        return;
    }
    localStorage.setItem(accountAvatarKey(uid), dataUrl);
    localStorage.setItem(remoteKey, remoteName);
    renderAccountAvatar();
}

function initAccountAvatar() {
    const input = $('acc-avatar-file');
    const save = $('acc-profile-save');
    const cancel = $('acc-profile-cancel');
    if (!save) return;
    renderAccountAvatar();
    if (input) input.addEventListener('change', () => {
        if (accountAvatarPreviewUrl) URL.revokeObjectURL(accountAvatarPreviewUrl);
        accountAvatarPreviewUrl = input.files && input.files[0] ? URL.createObjectURL(input.files[0]) : '';
        if (accountAvatarPreviewUrl) {
            $('acc-avatar-image').src = accountAvatarPreviewUrl;
            $('acc-avatar-image').hidden = false;
            $('acc-avatar-placeholder').hidden = true;
        } else renderAccountAvatar();
    });
    if (input && cancel) cancel.addEventListener('click', () => {
        input.value = '';
        if (accountAvatarPreviewUrl) URL.revokeObjectURL(accountAvatarPreviewUrl);
        accountAvatarPreviewUrl = '';
        renderAccountAvatar();
    });
    save.addEventListener('click', async () => {
        const file = input && input.files && input.files[0];
        const weightInput = $('acc-profile-weight');
        const heightInput = $('acc-profile-height');
        const ageInput = $('acc-profile-age');
        const weight = weightInput.value.trim();
        const height = heightInput ? heightInput.value.trim() : '';
        const age = ageInput.value.trim();
        if (weight && (!Number.isFinite(Number(weight)) || Number(weight) < 25 || Number(weight) > 250)) { toast('El peso debe estar entre 25 y 250 kg.'); return; }
        if (height && (!Number.isInteger(Number(height)) || Number(height) < 120 || Number(height) > 230)) { toast('La altura debe estar entre 120 y 230 cm.'); return; }
        if (age && (!Number.isInteger(Number(age)) || Number(age) < 10 || Number(age) > 100)) { toast('La edad debe estar entre 10 y 100 años.'); return; }
        save.disabled = true;
        try {
            const dataUrl = file ? await accountAvatarDataUrl(await accountAvatarToJpeg(file)) : '';
            const uid = Cloud.uid;
            if (!uid) throw new Error('Inicia sesión para guardar el avatar.');
            if (dataUrl) localStorage.setItem(accountAvatarKey(uid), dataUrl);
            localStorage.setItem('mtb_pro_avatar_last_uid', uid);
            const pendingKey = accountAvatarPendingKey(uid);
            let previousPending = {};
            try { previousPending = JSON.parse(localStorage.getItem(pendingKey) || '{}') || {}; }
            catch (_) {}
            const hadValue = value => value !== undefined && value !== null && String(value) !== '';
            const wasPendingClear = field => Array.isArray(previousPending.clearedFields)
                && previousPending.clearedFields.includes(field);
            const previousProfileValue = field => accountProfileSnapshot.uid === uid
                ? accountProfileSnapshot[field]
                : undefined;
            const clearedFields = [];
            if (weight === '' && (hadValue(previousProfileValue('weightKg')) || hadValue(previousPending.weightKg) || wasPendingClear('weightKg'))) clearedFields.push('weightKg');
            if (height === '' && (hadValue(previousProfileValue('heightCm')) || hadValue(previousPending.heightCm) || wasPendingClear('heightCm'))) clearedFields.push('heightCm');
            if (age === '' && (hadValue(previousProfileValue('age')) || hadValue(previousPending.age) || wasPendingClear('age'))) clearedFields.push('age');
            localStorage.setItem(pendingKey, JSON.stringify({ avatar: dataUrl, weightKg: weight, heightCm: height, age, clearedFields }));
            if (typeof statsApplyAccountProfile === 'function') {
                statsApplyAccountProfile(
                    clearedFields.includes('weightKg') ? 0 : weight,
                    clearedFields.includes('age') ? 0 : age,
                    clearedFields.includes('heightCm') ? 0 : height
                );
            }
            renderAccountAvatar();
            if (input) input.value = '';
            if (accountAvatarPreviewUrl) URL.revokeObjectURL(accountAvatarPreviewUrl);
            accountAvatarPreviewUrl = '';
            if (navigator.onLine) {
                try {
                    await syncPendingAccountAvatar();
                    toast(dataUrl ? 'Perfil y avatar guardados en este teléfono y sincronizados.' : 'Perfil guardado y sincronizado con tu cuenta.');
                } catch (error) {
                    console.warn('Avatar guardado localmente; queda pendiente de sincronización:', error);
                    toast('Perfil guardado en este teléfono; se sincronizará cuando haya conexión.');
                }
            } else toast('Perfil guardado en este teléfono; se sincronizará cuando haya conexión.');
        } catch (error) {
            console.warn('No se pudo guardar el avatar:', error);
            toast(error.message || 'No se pudo guardar el avatar.');
        } finally { save.disabled = false; }
    });
}
