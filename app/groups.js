'use strict';

//  POSICIONES DEL GRUPO (PocketBase)
// ============================================================
let groupJoined = false, groupSyncAvailable = false, friendsTimer = null, restoreGroupPending = false;
let restoreGroupQueuedContext = null;
let friendsRefreshPending = false, lastLivePush = 0, lastFriendsRefreshAt = 0, livePushPending = false;
let lastGroupAuthRefreshAt = 0, lastGroupMembershipCheckAt = 0;
let pendingLiveLocation = null, pendingLiveLocationLoaded = false;
let pendingLiveLocationLoadPromise = null, pendingLiveLocationWrite = Promise.resolve();
let pendingLiveLocationRevision = 0, liveLocationRetryTimer = null;
let liveLocationRetryBlockedKey = '', liveLocationRetryBlockedStatus = 0;
let myLiveRecordId = null;
let groupLiveEndpointUnsupportedFor = '';
const friendMarkers = new Map();
const LIVE_INTERVAL_MS = 30000, FRIEND_STALE_MS = 120000;
const LIVE_PENDING_KEY = 'pendingLiveLocation';
const LIVE_PENDING_TTL_MS = FRIEND_STALE_MS;
const LIVE_RETRY_BASE_MS = 5000, LIVE_RETRY_MAX_MS = 60000;
const FRIENDS_IDLE_REFRESH_MS = 30000;
const GROUP_AUTH_REFRESH_MS = 5 * 60 * 1000;
const GROUP_MEMBERSHIP_CHECK_MS = 5 * 60 * 1000;

let groupInfo = null, groupChoices = [];

function groupName() { return Cloud.groupCode || ''; }

function reportPendingLiveLocationStorageError(error) {
    console.warn('No se pudo guardar la posición pendiente del grupo:', error);
    $('group-status').textContent = 'No se pudo guardar la posición pendiente; se reintentará mientras la aplicación siga abierta.';
}

function queuePendingLiveLocationWrite(value) {
    const write = pendingLiveLocationWrite.then(() => value
        ? DB.kvSet(LIVE_PENDING_KEY, value)
        : DB.kvDel(LIVE_PENDING_KEY));
    pendingLiveLocationWrite = write.catch(reportPendingLiveLocationStorageError);
    return write;
}

function validPendingLiveLocation(value) {
    const now = Date.now();
    return value && value.ownerId === Cloud.uid && value.groupCode === groupName()
        && Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90
        && Number.isFinite(value.lon) && value.lon >= -180 && value.lon <= 180
        && typeof value.name === 'string' && value.name.length > 0
        && Number.isFinite(value.accuracy) && value.accuracy >= 0 && value.accuracy <= MAX_ACC_M
        && Number.isFinite(value.updatedAt) && value.updatedAt <= now + 30000
        && now - value.updatedAt <= LIVE_PENDING_TTL_MS
        && Number.isInteger(value.retryAttempt) && value.retryAttempt >= 0
        && Number.isFinite(value.retryAt);
}

async function loadPendingLiveLocation() {
    if (pendingLiveLocationLoaded) return;
    if (pendingLiveLocationLoadPromise) return pendingLiveLocationLoadPromise;
    const load = (async () => {
        const revision = pendingLiveLocationRevision;
        try {
            const saved = await DB.kvGet(LIVE_PENDING_KEY);
            if (revision !== pendingLiveLocationRevision) return;
            if (saved && validPendingLiveLocation(saved)) {
                pendingLiveLocation = { ...saved, revision: ++pendingLiveLocationRevision };
            } else if (saved) {
                await queuePendingLiveLocationWrite(null);
            }
            pendingLiveLocationLoaded = true;
        } catch (error) {
            pendingLiveLocationLoaded = false;
            reportPendingLiveLocationStorageError(error);
        }
    })();
    pendingLiveLocationLoadPromise = load.finally(() => { pendingLiveLocationLoadPromise = null; });
    return pendingLiveLocationLoadPromise;
}

function persistPendingLiveLocation() {
    if (!pendingLiveLocation) return Promise.resolve();
    const value = { ...pendingLiveLocation };
    delete value.revision;
    return queuePendingLiveLocationWrite(value);
}

function clearPendingLiveLocation() {
    pendingLiveLocationRevision++;
    pendingLiveLocation = null;
    pendingLiveLocationLoaded = true;
    if (liveLocationRetryTimer) clearTimeout(liveLocationRetryTimer);
    liveLocationRetryTimer = null;
    return queuePendingLiveLocationWrite(null);
}

function scheduleLiveLocationRetry(retryAt) {
    if (liveLocationRetryTimer) clearTimeout(liveLocationRetryTimer);
    liveLocationRetryTimer = null;
    if (!Number.isFinite(retryAt) || retryAt <= 0) return;
    liveLocationRetryTimer = setTimeout(() => {
        liveLocationRetryTimer = null;
        if (navigator.onLine) retryPendingLiveLocation();
    }, Math.max(0, retryAt - Date.now()));
}

function liveLocationIdentityKey() {
    return `${Cloud.server}|${Cloud.uid}|${groupName()}`;
}

function liveLocationRetryIsBlocked() {
    if (!liveLocationRetryBlockedKey) return false;
    if (liveLocationRetryBlockedKey !== liveLocationIdentityKey()) {
        liveLocationRetryBlockedKey = '';
        liveLocationRetryBlockedStatus = 0;
        return false;
    }
    return true;
}

function updatePendingLiveLocation(nickname) {
    const prior = pendingLiveLocation;
    const sameGroup = prior && prior.ownerId === Cloud.uid && prior.groupCode === groupName();
    pendingLiveLocation = {
        ownerId: Cloud.uid,
        groupCode: groupName(),
        name: nickname,
        lat: lastLat,
        lon: lastLon,
        accuracy: Number.isFinite(lastAccuracy) ? lastAccuracy : 0,
        updatedAt: Date.now(),
        retryAttempt: sameGroup ? prior.retryAttempt : 0,
        retryAt: sameGroup ? prior.retryAt : 0,
        revision: ++pendingLiveLocationRevision
    };
    return pendingLiveLocation;
}

function pendingGroupLeaveKey() {
    return Cloud.uid ? `mtb_pro_pending_group_leave_${encodeURIComponent(Cloud.server)}_${Cloud.uid}` : '';
}
function hasPendingGroupLeave() {
    const key = pendingGroupLeaveKey();
    return Boolean(key && localStorage.getItem(key));
}
function clearPendingGroupLeave(groupId) {
    const key = pendingGroupLeaveKey();
    if (!key) return;
    try {
        const pending = JSON.parse(localStorage.getItem(key) || 'null');
        if (pending && pending.groupId === groupId) localStorage.removeItem(key);
    } catch (_) { localStorage.removeItem(key); }
}

async function syncPendingGroupLeave() {
    const key = pendingGroupLeaveKey();
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const isCurrent = () => Cloud.loggedIn() && Cloud.server === server
        && Cloud.uid === uid && Cloud.authGeneration === generation;
    if (!key || !isCurrent() || !navigator.onLine) return false;
    let pending;
    try { pending = JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { pending = null; }
    if (!pending || !pending.groupId) {
        localStorage.removeItem(key);
        return true;
    }

    const auth = await Cloud.refreshSession();
    if (!auth || !isCurrent()) return false;
    if (auth.groupCode === pending.groupId) {
        Cloud.invalidateProfileReads();
        await cloudApi('/api/mtb/groups/leave', 'POST', null, { server });
        if (!isCurrent()) return false;
        Cloud.invalidateProfileReads();
    }
    const fresh = await Cloud.refreshSession();
    if (!fresh || !isCurrent()) return false;
    localStorage.removeItem(key);
    groupJoined = false;
    groupSyncAvailable = false;
    myLiveRecordId = null;
    localStorage.removeItem('mtb_pro_group_joined');
    await loadMyGroup();
    if (!isCurrent()) return false;
    renderFriends();
    renderAccount();
    return true;
}

function friendAvatarUrl(record) {
    const avatarName = String(record.avatar || '').trim();
    return avatarName && record.owner
        ? `${Cloud.server}/api/files/users/${encodeURIComponent(record.owner)}/${encodeURIComponent(avatarName)}?thumb=96x96`
        : '';
}

function showFriendOnMap(friend) {
    const position = [Number(friend.lat), Number(friend.lon)];
    goToPage(0);
    if (map) map.setView(position, Math.max(map.getZoom(), 16));
    const marker = friendMarkers.get(friend.id);
    if (marker) marker.openPopup();
}

function renderFriendsGroupStatus(liveMembers = []) {
    const status = $('friends-group-status');
    const connected = groupJoined && groupSyncAvailable;
    status.classList.toggle('connected', connected);
    status.classList.toggle('has-live-members', connected && liveMembers.length > 0);
    status.textContent = '';

    if (!connected) {
        status.textContent = groupJoined ? '🟡 Grupo guardado · esperando conexión' : 'Sin conexión a un grupo';
        return;
    }

    if (!liveMembers.length) {
        const groupLabel = groupInfo && groupInfo.name ? ` al grupo «${groupInfo.name}»` : ' al grupo';
        status.textContent = `🟢 Conectado${groupLabel} · sin compañeros en vivo`;
        return;
    }

    for (const member of liveMembers) {
        const name = String(member.nickname || member.name || '').trim() || 'Compañero';
        const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('es-ES') || '•';
        const card = document.createElement('div');
        card.className = 'friend-live-member';

        const label = document.createElement('span');
        label.className = 'friend-live-name';
        label.textContent = name;

        const avatar = document.createElement('button');
        avatar.type = 'button';
        avatar.className = 'friend-live-avatar';
        avatar.setAttribute('aria-label', `Mostrar la posición de ${name} en el mapa`);
        avatar.title = `Ver la posición de ${name} en el mapa`;
        avatar.addEventListener('click', () => showFriendOnMap(member));
        const fallback = document.createElement('span');
        fallback.className = 'friend-live-initials';
        fallback.textContent = initials;
        avatar.appendChild(fallback);

        const url = friendAvatarUrl(member);
        if (url) {
            const image = document.createElement('img');
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            image.addEventListener('load', () => { fallback.hidden = true; }, { once: true });
            image.addEventListener('error', () => image.remove(), { once: true });
            image.src = url;
            avatar.appendChild(image);
        }

        card.append(label, avatar);
        status.appendChild(card);
    }
}

function renderGroupChoices(activeId = '') {
    const box = $('group-list');
    box.textContent = '';
    for (const group of groupChoices) {
        const active = group.id === activeId;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `group-shortcut${active ? ' is-active' : ''}`;
        button.disabled = active;
        button.setAttribute('aria-pressed', String(active));
        button.title = active ? `${group.name} (grupo activo)` : `Entrar en ${group.name}`;

        const icon = document.createElement('span');
        icon.className = 'group-shortcut-icon';
        icon.setAttribute('aria-hidden', 'true');
        const words = String(group.name || '').trim().split(/\s+/).filter(Boolean);
        const initials = document.createElement('span');
        initials.className = 'group-shortcut-initials';
        initials.textContent = words.length > 1
            ? `${words[0].slice(0, 1)}${words[1].slice(0, 1)}`.toUpperCase()
            : (words[0] || 'GR').slice(0, 2).toUpperCase();
        icon.appendChild(initials);

        if (group.icon) {
            const image = document.createElement('img');
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            image.addEventListener('load', () => icon.classList.add('has-image'), { once: true });
            image.addEventListener('error', () => image.remove(), { once: true });
            image.src = `${Cloud.server}/api/files/mtb_groups/${encodeURIComponent(group.id)}/${encodeURIComponent(group.icon)}?thumb=96x96`;
            icon.appendChild(image);
        }

        const name = document.createElement('span');
        name.className = 'group-shortcut-name';
        name.textContent = group.name;
        button.append(icon, name);
        if (active) {
            const state = document.createElement('span');
            state.className = 'group-shortcut-state';
            state.textContent = 'Activo';
            button.appendChild(state);
        } else {
            button.addEventListener('click', () => selectGroup(group.id));
        }
        box.appendChild(button);
    }
    $('group-choices').style.display = groupChoices.length ? 'block' : 'none';
}

function renderGroupState(connected) {
    $('group-setup').style.display = connected ? 'none' : 'block';
    $('group-connected').style.display = connected ? 'block' : 'none';
    $('group-admin-panel').style.display = connected && groupInfo && groupInfo.isAdmin ? 'block' : 'none';
    $('btn-leave').hidden = Boolean(connected && groupInfo && groupInfo.isAdmin);
    $('group-invite-code').textContent = groupInfo && groupInfo.isAdmin ? groupInfo.inviteCode : '';
    $('group-connected-label').textContent = connected && groupInfo ? (groupInfo.name + (groupInfo.isAdmin ? ' · Administrador' : ' · Miembro')) : 'Grupo activo';
    $('group-choices').style.display = groupChoices.length ? 'block' : 'none';
    renderFriendsGroupStatus();
    renderGroupChoices(groupInfo ? groupInfo.id : '');
    $('group-status').textContent = connected
        ? !groupSyncAvailable ? 'Grupo guardado en este dispositivo. Se sincronizará al recuperar conexión.'
            : !Cloud.nickname ? 'Añade un apodo a tu cuenta para identificarte en el grupo.'
                : (isRecording && !isPaused ? 'Grupo activo: compartiendo tu posición.' : 'Tu posición se compartirá cuando grabes.')
        : !Cloud.nickname ? 'Añade un apodo a tu cuenta antes de entrar en un grupo.'
            : 'Puedes volver a entrar en tus grupos autorizados. El administrador puede revocar el acceso.';
    if (connected && groupInfo && groupInfo.isAdmin) loadAdminMembers();
}

async function stopGroup() {
    groupJoined = false;
    groupSyncAvailable = false;
    groupInfo = null;
    localStorage.removeItem('mtb_pro_group_joined');
    if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
    await removeMyLiveLocation();
    renderGroupState(false);
    renderFriends();
    if (currentPage === 2) await loadGroupRankings();
}

function startFriendsTimer() {
    if (friendsTimer) clearInterval(friendsTimer);
    friendsTimer = setInterval(() => {
        if (document.visibilityState !== 'visible' || !navigator.onLine) return;
        // Las posiciones solo se consultan cuando el mapa o el panel de grupo
        // están a la vista; al volver, renderPage fuerza una actualización.
        if (currentPage !== 0 && currentPage !== 2) return;
        // Durante la grabación, las publicaciones de posición ya refrescan la lista de amigos.
        const minimumInterval = isRecording && !isPaused ? LIVE_INTERVAL_MS : FRIENDS_IDLE_REFRESH_MS;
        if (Date.now() - lastFriendsRefreshAt < minimumInterval) return;
        refreshFriends();
    }, FRIENDS_IDLE_REFRESH_MS);
}

async function loadMyGroup() {
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const profileGeneration = Cloud.profileGeneration;
    const isCurrent = () => Cloud.loggedIn() && Cloud.server === server && Cloud.uid === uid
        && Cloud.authGeneration === generation && Cloud.profileGeneration === profileGeneration;
    const result = await cloudApi('/api/mtb/groups/my', 'GET', null, { server });
    if (!isCurrent()) return null;
    groupChoices = Array.isArray(result.groups) ? result.groups : [];
    const activeId = result.activeGroupId || '';
    groupInfo = groupChoices.find(group => group.id === activeId) || null;
    // PocketBase es la fuente de verdad. La marca local solo era una caché y
    // puede desaparecer al actualizar/reinstalar la app aunque siga la membresía.
    groupJoined = Boolean(groupInfo);
    if (groupJoined) localStorage.setItem('mtb_pro_group_joined', activeId);
    groupSyncAvailable = true;
    if (activeId) localStorage.setItem('mtb_pro_group_code', activeId);
    else localStorage.removeItem('mtb_pro_group_code');
    if (!groupJoined) localStorage.removeItem('mtb_pro_group_joined');
    renderGroupState(groupJoined);
    if (currentPage === 2) await loadGroupRankings();
    if (!isCurrent()) return null;
    return groupInfo;
}

async function loadAdminMembers() {
    try {
        const result = await cloudApi('/api/mtb/groups/members');
        const box = $('group-members-list');
        box.textContent = '';
        for (const member of result.members || []) {
            const row = document.createElement('div');
            row.className = 'friend-row';
            const label = document.createElement('div');
            label.className = 'friend-name';
            label.textContent = member.nickname + (member.isAdmin ? ' · Tú' : '');
            row.appendChild(label);
            if (!member.isAdmin) {
                const actions = document.createElement('div');
                actions.className = 'group-member-actions';
                const transfer = document.createElement('button');
                transfer.type = 'button';
                transfer.className = 'btn-small secondary';
                transfer.textContent = 'Pasar admin';
                transfer.addEventListener('click', async () => {
                    if (!confirm(`La administración pasará a ${member.nickname}. El grupo y sus miembros se conservarán. ¿Continuar?`)) return;
                    try {
                        await cloudApi('/api/mtb/groups/transfer', 'POST', { userId: member.userId });
                        await loadMyGroup();
                        toast(`Administración transferida a ${member.nickname}.`);
                    } catch (e) { toast('No se pudo transferir la administración: ' + e.message, 6000); }
                });
                actions.appendChild(transfer);
                const revoke = document.createElement('button');
                revoke.type = 'button';
                revoke.className = 'btn-small danger friend-locate';
                revoke.textContent = 'Revocar';
                revoke.addEventListener('click', async () => {
                    if (!confirm('Esta persona perderá el acceso y necesitará una nueva invitación para volver. ¿Revocar?')) return;
                    try {
                        const res = await cloudApi('/api/mtb/groups/revoke', 'POST', { userId: member.userId });
                        if (res && res.inviteCode && groupInfo) {
                            groupInfo.inviteCode = res.inviteCode;
                            $('group-invite-code').textContent = res.inviteCode;
                        }
                        await loadAdminMembers();
                        toast('Acceso revocado y código de invitación renovado.');
                    } catch (e) { toast('No se pudo revocar el acceso: ' + e.message, 6000); }
                });
                actions.appendChild(revoke);
                row.appendChild(actions);
            }
            box.appendChild(row);
        }
        if (!(result.members || []).length) box.textContent = 'Todavía no hay miembros.';
    } catch (e) {
        $('group-members-list').textContent = 'No se pudo cargar la lista de miembros.';
        console.warn('Miembros del grupo:', e);
    }
}

async function selectGroup(groupId) {
    if (!Cloud.loggedIn()) { toast('Inicia sesión para entrar en el grupo.'); return; }
    if (!Cloud.nickname) { toast('Añade un apodo a tu cuenta antes de entrar en un grupo.'); return; }
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const isCurrent = () => Cloud.loggedIn() && Cloud.server === server
        && Cloud.uid === uid && Cloud.authGeneration === generation;
    try {
        const switchingActiveGroup = groupJoined && groupName() !== groupId;
        if (switchingActiveGroup) {
            if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
            await removeMyLiveLocation();
            if (!isCurrent()) return;
        }
        await cloudApi('/api/mtb/groups/select', 'POST', { groupId }, { server });
        if (!isCurrent()) return;
        const auth = await Cloud.refreshSession();
        if (!isCurrent()) return;
        if (!auth) {
            await restoreGroup();
            return;
        }
        clearPendingGroupLeave(groupId);
        localStorage.setItem('mtb_pro_group_joined', groupId);
        groupJoined = true;
        groupSyncAvailable = true;
        await loadMyGroup();
        if (!isCurrent()) return;
        await refreshFriends();
        if (!isCurrent()) return;
        startFriendsTimer();
        if (isRecording && !isPaused) publishMyLocation(true);
        toast('Has vuelto a entrar en el grupo.');
    } catch (e) {
        if (!isCurrent()) return;
        toast('No se pudo entrar en el grupo: ' + e.message, 6000);
        await restoreGroup();
    }
}

async function restoreGroup() {
    if (!Cloud.loggedIn() || Cloud.logoutInProgress) return;
    if (restoreGroupPending) {
        restoreGroupQueuedContext = {
            server: Cloud.server,
            uid: Cloud.uid,
            generation: Cloud.authGeneration
        };
        return;
    }
    restoreGroupPending = true;
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const isCurrent = () => Cloud.loggedIn() && Cloud.server === server
        && Cloud.uid === uid && Cloud.authGeneration === generation;
    try {
        if (hasPendingGroupLeave()) {
            groupJoined = false;
            groupSyncAvailable = false;
            try { await clearPendingLiveLocation(); }
            catch (error) { reportPendingLiveLocationStorageError(error); }
            if (!isCurrent()) return;
            localStorage.removeItem('mtb_pro_group_joined');
            localStorage.removeItem('mtb_pro_group_code');
            if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
            renderGroupState(false);
            renderFriends();
            if (navigator.onLine) {
                try {
                    const leaveCompleted = await syncPendingGroupLeave();
                    if (!isCurrent()) return;
                    if (!leaveCompleted) {
                        $('group-status').textContent = 'Has salido en este dispositivo; se completará la salida del servidor al recuperar conexión.';
                        return;
                    }
                    await syncPendingGroupRankingDeletes();
                    if (!isCurrent()) return;
                }
                catch (e) {
                    if (!isCurrent()) return;
                    localStorage.removeItem('mtb_pro_group_code');
                    $('group-status').textContent = 'Has salido en este dispositivo; se completará la salida del servidor al recuperar conexión.';
                    console.warn('Salida del grupo pendiente:', e);
                }
            } else {
                $('group-status').textContent = 'Has salido en este dispositivo; la salida del servidor está pendiente de conexión.';
            }
            return;
        }
        const savedGroupId = localStorage.getItem('mtb_pro_group_joined');
        if (!groupJoined && savedGroupId && savedGroupId === groupName()) {
            groupJoined = true;
            groupSyncAvailable = false;
            groupInfo = groupInfo || { id: savedGroupId };
            renderGroupState(true);
            renderFriends();
            startFriendsTimer();
        }
        try {
            const auth = await Cloud.refreshSession();
            if (!auth || !isCurrent()) return;
            await syncPendingGroupRankingDeletes();
            if (!isCurrent()) return;
            await loadMyGroup();
            if (!isCurrent()) return;
            if (!groupJoined) {
                if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
                renderFriends();
                return;
            }
            await refreshFriends();
            if (!isCurrent()) return;
            startFriendsTimer();
            if (isRecording && !isPaused) publishMyLocation(true);
        } catch (e) {
            if (!isCurrent()) return;
            groupSyncAvailable = false;
            if (groupJoined) renderGroupState(true);
            console.warn('No se pudo restaurar el grupo:', e);
            $('group-status').textContent = e.status === 404
                ? 'PocketBase no tiene instaladas las rutas de gestión de grupos (groups.pb.js).'
                : e.status !== undefined
                    ? `No se pudo restaurar el grupo desde PocketBase: ${e.message}`
                    : 'Sin conexión con PocketBase; se reintentará restaurar tus grupos al recuperar la red.';
        }
    } finally {
        restoreGroupPending = false;
        const queued = restoreGroupQueuedContext;
        restoreGroupQueuedContext = null;
        if (queued && Cloud.loggedIn() && Cloud.server === queued.server
            && Cloud.uid === queued.uid && Cloud.authGeneration === queued.generation) {
            Promise.resolve().then(() => restoreGroup());
        }
    }
}

function renderFriends(items = []) {
    const now = Date.now();
    const live = items.filter(x => {
        const updatedAt = Date.parse(x.updated);
        return x.owner !== Cloud.uid
            && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon))
            && Number.isFinite(updatedAt) && updatedAt <= now + 30000
            && now - updatedAt < FRIEND_STALE_MS;
    });
    renderFriendsGroupStatus(live);
    const ids = new Set(live.map(x => x.id));
    for (const [id, marker] of friendMarkers) {
        if (!ids.has(id)) { if (map) map.removeLayer(marker); friendMarkers.delete(id); }
    }
    if (!live.length) return;
    live.forEach(rec => {
        const name = String(rec.nickname || rec.name || 'Compañero').trim();
        const ll = [Number(rec.lat), Number(rec.lon)];
        let marker = friendMarkers.get(rec.id);
        if (map) {
            const avatarUrl = friendAvatarUrl(rec);
            const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('es-ES') || '•';
            const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
            const icon = L.divIcon({
                className: 'friend-map-avatar-icon',
                html: avatarUrl
                    ? `<img class="friend-map-avatar" src="${escapeHtml(avatarUrl)}" alt="" referrerpolicy="no-referrer"><span class="friend-map-initials" aria-hidden="true">${escapeHtml(initials)}</span>`
                    : `<span class="friend-map-initials">${escapeHtml(initials)}</span>`,
                iconSize: [42, 42], iconAnchor: [21, 21]
            });
            if (!marker) {
                marker = L.marker(ll, { icon, title: name, alt: name, keyboard: true }).addTo(map);
                friendMarkers.set(rec.id, marker);
            } else {
                marker.setLatLng(ll);
                marker.setIcon(icon);
                marker.options.title = name;
            }
            const popup = document.createElement('div');
            popup.className = 'friend-map-popup';
            const popupName = document.createElement('strong');
            popupName.className = 'friend-map-popup-name';
            popupName.textContent = name;
            const popupTime = document.createElement('div');
            popupTime.className = 'friend-map-popup-time';
            popupTime.textContent = `Actualizado ${new Date(rec.updated).toLocaleTimeString('es-ES')}`;
            popup.append(popupName, popupTime);
            marker.bindPopup(popup);
        }
    });
}

async function refreshFriends(retryAuth = true, ownsPending = false) {
    if (!groupJoined || !Cloud.loggedIn() || !navigator.onLine || document.visibilityState !== 'visible'
        || (friendsRefreshPending && !ownsPending)) return;
    if (!ownsPending) friendsRefreshPending = true;
    lastFriendsRefreshAt = Date.now();
    const wasSyncAvailable = groupSyncAvailable;
    try {
        const expectedGroup = groupName();
        const now = Date.now();
        if (now - lastGroupAuthRefreshAt >= GROUP_AUTH_REFRESH_MS) {
            const auth = await Cloud.refreshSession();
            if (!auth) return;
            lastGroupAuthRefreshAt = now;
            if (auth.groupCode !== expectedGroup || !expectedGroup) {
                groupJoined = false;
                localStorage.removeItem('mtb_pro_group_joined');
                await removeMyLiveLocation();
                await loadMyGroup();
                renderFriends();
                toast('El administrador ha revocado tu acceso a este grupo.');
                return;
            }
        }
        if (now - lastGroupMembershipCheckAt >= GROUP_MEMBERSHIP_CHECK_MS) {
            const membership = await cloudApi('/api/mtb/groups/my');
            lastGroupMembershipCheckAt = now;
            if (membership.activeGroupId !== expectedGroup || !expectedGroup) {
                groupJoined = false;
                localStorage.removeItem('mtb_pro_group_joined');
                await removeMyLiveLocation();
                await loadMyGroup();
                renderFriends();
                toast('El administrador ha revocado tu acceso a este grupo.');
                return;
            }
        }
        const f = encodeURIComponent('groupCode = "' + expectedGroup + '"');
        let res;
        if (groupLiveEndpointUnsupportedFor !== Cloud.server) {
            try {
                res = await cloudApi('/api/mtb/groups/live');
                groupLiveEndpointUnsupportedFor = '';
            } catch (e) {
                if (e.status !== 404) throw e;
                groupLiveEndpointUnsupportedFor = Cloud.server;
            }
        }
        if (!res) res = await cloudApi('/api/collections/live_locations/records?filter=' + f + '&perPage=200&sort=-updated');
        if (liveLocationRetryBlockedKey === liveLocationIdentityKey()
            && (liveLocationRetryBlockedStatus === 401 || liveLocationRetryBlockedStatus === 403)) {
            liveLocationRetryBlockedKey = '';
            liveLocationRetryBlockedStatus = 0;
        }
        groupSyncAvailable = true;
        const own = res.items.find(x => x.owner === Cloud.uid);
        myLiveRecordId = own ? own.id : null;
        renderFriends(res.items);
        if (!wasSyncAvailable && isRecording && !isPaused) publishMyLocation(true);
    } catch (e) {
        groupSyncAvailable = false;
        renderFriends();
        if (groupJoined) {
            $('friends-group-status').textContent = 'No se pudo verificar la ubicación en vivo; se retiraron las posiciones anteriores.';
        }
        console.warn('Posiciones del grupo:', e);
        if ((e.status === 401 || e.status === 403) && retryAuth) {
            try {
                const auth = await Cloud.refreshSession();
                if (!auth) return;
                lastGroupAuthRefreshAt = Date.now();
                await refreshFriends(false, true);
            } catch (refreshError) {
                console.warn('No se pudo renovar la sesión del grupo:', refreshError);
                $('group-status').textContent = 'Conexión pendiente: no se pudo verificar el grupo.';
            }
        } else if (e.status !== undefined && e.status !== 404) {
            $('group-status').textContent = 'No se pudieron cargar posiciones. Revisa la conexión y PocketBase.';
        }
    } finally {
        if (!ownsPending) friendsRefreshPending = false;
    }
}
async function publishMyLocation(force = false) {
    if ((typeof safetyGroupTrackingEnabled === 'function' && !safetyGroupTrackingEnabled())
        || !groupJoined || !Cloud.loggedIn() || !isRecording || isPaused || lastLat === null || lastLon === null
        || !Number.isFinite(lastLat) || lastLat < -90 || lastLat > 90
        || !Number.isFinite(lastLon) || lastLon < -180 || lastLon > 180
        || !Number.isFinite(lastPositionAt) || Date.now() - lastPositionAt > LIVE_PENDING_TTL_MS
        || !Number.isFinite(lastAccuracy) || lastAccuracy < 0 || lastAccuracy > MAX_ACC_M) return;
    if (liveLocationRetryIsBlocked()) return;
    const nickname = String(Cloud.nickname || '').trim();
    if (!nickname) {
        $('group-status').textContent = 'Añade un apodo a tu cuenta antes de compartir tu posición.';
        return;
    }
    await loadPendingLiveLocation();
    if ((typeof safetyGroupTrackingEnabled === 'function' && !safetyGroupTrackingEnabled())
        || !groupJoined || !Cloud.loggedIn() || !isRecording || isPaused) return;
    if (!pendingLiveLocation && !force && Date.now() - lastLivePush < LIVE_INTERVAL_MS && navigator.onLine) return;
    const snapshot = updatePendingLiveLocation(nickname);
    if (!navigator.onLine || livePushPending) {
        try { await persistPendingLiveLocation(); }
        catch (error) { reportPendingLiveLocationStorageError(error); }
        return;
    }
    if (snapshot.retryAt > Date.now()) {
        try { await persistPendingLiveLocation(); }
        catch (error) { reportPendingLiveLocationStorageError(error); }
        scheduleLiveLocationRetry(snapshot.retryAt);
        return;
    }
    if (!force && Date.now() - lastLivePush < LIVE_INTERVAL_MS) {
        snapshot.retryAt = lastLivePush + LIVE_INTERVAL_MS;
        try { await persistPendingLiveLocation(); }
        catch (error) { reportPendingLiveLocationStorageError(error); }
        scheduleLiveLocationRetry(snapshot.retryAt);
        return;
    }
    await sendPendingLiveLocation(snapshot);
}

async function retryPendingLiveLocation() {
    if ((typeof safetyGroupTrackingEnabled === 'function' && !safetyGroupTrackingEnabled())
        || !groupJoined || !Cloud.loggedIn() || !isRecording || isPaused || !navigator.onLine) return;
    if (liveLocationRetryIsBlocked()) return;
    await loadPendingLiveLocation();
    const snapshot = pendingLiveLocation;
    if (!snapshot) return;
    if (!validPendingLiveLocation(snapshot)) {
        try { await clearPendingLiveLocation(); }
        catch (error) { reportPendingLiveLocationStorageError(error); }
        return;
    }
    if (!Number.isFinite(lastLat) || lastLat < -90 || lastLat > 90
        || !Number.isFinite(lastLon) || lastLon < -180 || lastLon > 180
        || !Number.isFinite(lastPositionAt) || Date.now() - lastPositionAt > LIVE_PENDING_TTL_MS
        || !Number.isFinite(lastAccuracy) || lastAccuracy < 0 || lastAccuracy > MAX_ACC_M) return;
    if (snapshot.retryAt > Date.now()) {
        scheduleLiveLocationRetry(snapshot.retryAt);
        return;
    }
    await sendPendingLiveLocation(snapshot);
}

async function sendPendingLiveLocation(snapshot) {
    if (typeof safetyGroupTrackingEnabled === 'function' && !safetyGroupTrackingEnabled()) {
        await removeMyLiveLocation();
        return;
    }
    if (livePushPending || !snapshot) return;
    livePushPending = true;
    try {
        try { await persistPendingLiveLocation(); }
        catch (error) { reportPendingLiveLocationStorageError(error); }
        if ((typeof safetyGroupTrackingEnabled === 'function' && !safetyGroupTrackingEnabled())
            || !groupJoined || !Cloud.loggedIn() || !isRecording || isPaused
            || groupName() !== snapshot.groupCode || Cloud.uid !== snapshot.ownerId) {
            await removeMyLiveLocation();
            return;
        }
        const payload = {
            owner: snapshot.ownerId,
            groupCode: snapshot.groupCode,
            name: snapshot.name,
            lat: snapshot.lat,
            lon: snapshot.lon,
            accuracy: snapshot.accuracy
        };
        if (!myLiveRecordId) {
            const f = encodeURIComponent(`owner = "${snapshot.ownerId}"`);
            const own = await cloudApi(`/api/collections/live_locations/records?filter=${f}&perPage=1`);
            myLiveRecordId = own.items[0] ? own.items[0].id : null;
        }
        if (myLiveRecordId) await cloudApi(`/api/collections/live_locations/records/${myLiveRecordId}`, 'PATCH', payload);
        else {
            const rec = await cloudApi('/api/collections/live_locations/records', 'POST', payload);
            myLiveRecordId = rec.id;
        }
        if ((typeof safetyGroupTrackingEnabled === 'function' && !safetyGroupTrackingEnabled())
            || !groupJoined || !isRecording || isPaused || groupName() !== snapshot.groupCode || Cloud.uid !== snapshot.ownerId) {
            await removeMyLiveLocation();
            return;
        }
        lastLivePush = Date.now();
        if (pendingLiveLocation && pendingLiveLocation.revision === snapshot.revision) {
            await clearPendingLiveLocation();
        } else if (pendingLiveLocation) {
            pendingLiveLocation.retryAttempt = 0;
            pendingLiveLocation.retryAt = lastLivePush + LIVE_INTERVAL_MS;
            try { await persistPendingLiveLocation(); }
            catch (error) { reportPendingLiveLocationStorageError(error); }
            scheduleLiveLocationRetry(pendingLiveLocation.retryAt);
        }
        refreshFriends();
    } catch (e) {
        console.warn('No se pudo compartir la ubicaci\u00f3n:', e);
        const hadLiveRecordId = Boolean(myLiveRecordId);
        groupSyncAvailable = false;
        renderFriendsGroupStatus();
        if (e.status === 404) myLiveRecordId = null;
        const retryable = e.retryable === true || e.status === undefined;
        const recoverStaleRecord = e.status === 404 && hadLiveRecordId;
        const willRetry = retryable || recoverStaleRecord;
        $('group-status').textContent = willRetry
            ? e.status !== undefined
                ? `Error al compartir ubicaci\u00f3n: ${e.message}. Se reintentar\u00e1 autom\u00e1ticamente.`
                : 'Sin conexi\u00f3n: la posici\u00f3n m\u00e1s reciente queda pendiente y se reintentar\u00e1 al recuperar cobertura.'
            : `No se pudo compartir la posici\u00f3n: ${e.message}. Se detuvieron los reintentos autom\u00e1ticos.`;
        if ((typeof safetyGroupTrackingEnabled !== 'function' || safetyGroupTrackingEnabled())
            && groupJoined && Cloud.loggedIn() && isRecording && !isPaused
            && groupName() === snapshot.groupCode && Cloud.uid === snapshot.ownerId) {
            if (willRetry) {
                const retry = pendingLiveLocation || snapshot;
                retry.retryAttempt = Math.min(20, retry.retryAttempt + 1);
                const delay = Math.min(LIVE_RETRY_BASE_MS * (2 ** (retry.retryAttempt - 1)), LIVE_RETRY_MAX_MS);
                retry.retryAt = Date.now() + delay;
                pendingLiveLocation = retry;
                try { await persistPendingLiveLocation(); }
                catch (error) { reportPendingLiveLocationStorageError(error); }
                scheduleLiveLocationRetry(retry.retryAt);
            } else {
                liveLocationRetryBlockedKey = liveLocationIdentityKey();
                liveLocationRetryBlockedStatus = e.status || 0;
            }
        }
    } finally { livePushPending = false; }
}

async function removeMyLiveLocation() {
    try { await clearPendingLiveLocation(); }
    catch (error) { reportPendingLiveLocationStorageError(error); }
    const id = myLiveRecordId;
    myLiveRecordId = null;
    if (id && Cloud.loggedIn()) {
        try { await cloudApi(`/api/collections/live_locations/records/${id}`, 'DELETE'); }
        catch (e) { console.warn('No se pudo retirar la posición:', e); }
    }
    renderFriends();
}

async function connectGroup(action) {
    if (!Cloud.loggedIn()) { toast('Inicia sesión para usar los grupos.'); return; }
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const isCurrent = () => Cloud.loggedIn() && Cloud.server === server
        && Cloud.uid === uid && Cloud.authGeneration === generation;
    try {
        const auth = await Cloud.refreshSession();
        if (!auth || !isCurrent()) return;
        if (!Cloud.nickname) { toast('Añade un apodo a tu cuenta antes de usar grupos.'); return; }
        let result;
        if (action === 'create') {
            const name = $('group-name').value.trim();
            const iconFile = $('group-icon').files[0];
            if (iconFile) {
                const iconBlob = await accountAvatarToJpeg(iconFile);
                if (!isCurrent()) return;
                const form = new FormData();
                form.append('name', name);
                form.append('icon', iconBlob, 'group-icon.jpg');
                Cloud.invalidateProfileReads();
                result = await cloudApi('/api/mtb/groups/create', 'POST', form, { timeoutMs: 60000, server });
            } else {
                Cloud.invalidateProfileReads();
                result = await cloudApi('/api/mtb/groups/create', 'POST', { name }, { server });
            }
        } else {
            const code = $('group-code').value.trim().toUpperCase();
            if (!/^[A-Z0-9]{12}$/.test(code)) { toast('Introduce un código de invitación de 12 caracteres.'); return; }
            Cloud.invalidateProfileReads();
            result = await cloudApi('/api/mtb/groups/join', 'POST', { code }, { server });
        }
        if (!isCurrent()) return;
        Cloud.invalidateProfileReads();
        const fresh = await Cloud.refreshSession();
        if (!isCurrent()) return;
        if (!fresh) {
            await restoreGroup();
            return;
        }
        clearPendingGroupLeave(result.group.id);
        await loadMyGroup();
        if (!isCurrent()) return;
        await refreshFriends();
        if (!isCurrent()) return;
        startFriendsTimer();
        if (isRecording && !isPaused) publishMyLocation(true);
        toast(action === 'create' ? 'Grupo creado: ya eres el administrador.' : 'Te has unido al grupo.');
    } catch (e) {
        if (!isCurrent()) return;
        console.warn('No se pudo acceder al grupo:', e);
        toast('No se pudo acceder al grupo: ' + e.message, 6000);
    }
}

$('btn-create-group').addEventListener('click', () => connectGroup('create'));
$('btn-join').addEventListener('click', () => connectGroup('join'));
$('group-rankings-refresh').addEventListener('click', () => {
    loadGroupRankings();
});
$('btn-update-group-icon').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin) return;
    const file = $('group-admin-icon').files[0];
    if (!file) {
        toast('Selecciona una imagen para el logo del grupo.');
        return;
    }
    const button = $('btn-update-group-icon');
    const status = $('group-icon-update-status');
    button.disabled = true;
    status.textContent = 'Guardando logo…';
    try {
        const iconBlob = await accountAvatarToJpeg(file);
        const form = new FormData();
        form.append('icon', iconBlob, 'group-icon.jpg');
        const result = await cloudApi('/api/mtb/groups/icon', 'POST', form, { timeoutMs: 60000 });
        groupInfo.icon = result.group.icon;
        const choice = groupChoices.find(group => group.id === groupInfo.id);
        if (choice) choice.icon = result.group.icon;
        $('group-admin-icon').value = '';
        renderGroupChoices(groupInfo.id);
        status.textContent = 'Logo actualizado.';
        toast('Logo del grupo actualizado.');
    } catch (error) {
        console.warn('No se pudo actualizar el logo del grupo:', error);
        status.textContent = `No se pudo actualizar el logo: ${error.message || 'error de conexión'}`;
    } finally {
        button.disabled = false;
    }
});
$('btn-copy-invite').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin) return;
    try {
        await navigator.clipboard.writeText(groupInfo.inviteCode);
        toast('Código de invitación copiado.');
    } catch (e) { toast('Código de invitación: ' + groupInfo.inviteCode, 6000); }
});
$('btn-rotate-invite').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin || !confirm('El código anterior dejará de servir para nuevas invitaciones. ¿Renovar?')) return;
    try {
        const result = await cloudApi('/api/mtb/groups/rotate-invite', 'POST');
        groupInfo = result.group;
        renderGroupState(true);
        toast('Código renovado. Los miembros actuales conservan el acceso.');
    } catch (e) { toast('No se pudo renovar el código: ' + e.message, 6000); }
});
$('btn-delete-group').addEventListener('click', async () => {
    if (!groupInfo || !groupInfo.isAdmin || !confirm('Se retirará el acceso a todos los miembros y se borrarán sus posiciones en vivo. ¿Eliminar el grupo?')) return;
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const isCurrent = () => Cloud.loggedIn() && Cloud.server === server
        && Cloud.uid === uid && Cloud.authGeneration === generation;
    try {
        await cloudApi('/api/mtb/groups/delete', 'POST', null, { server });
        if (!isCurrent()) return;
        Cloud.invalidateProfileReads();
        await stopGroup();
        if (!isCurrent()) return;
        const auth = await Cloud.refreshSession();
        if (!isCurrent()) return;
        if (!auth) {
            await restoreGroup();
            return;
        }
        await loadMyGroup();
        if (!isCurrent()) return;
        renderAccount();
        toast('Grupo eliminado; se han revocado las autorizaciones.');
    } catch (e) {
        if (!isCurrent()) return;
        toast('No se pudo eliminar el grupo: ' + e.message, 6000);
    }
});
async function leaveGroupLocally() {
    const groupId = groupName() || localStorage.getItem('mtb_pro_group_joined') || '';
    const key = pendingGroupLeaveKey();
    if (!groupId || !key) { toast('No hay un grupo activo que cerrar.'); return; }
    const server = Cloud.server;
    const uid = Cloud.uid;
    const generation = Cloud.authGeneration;
    const isCurrent = () => Cloud.loggedIn() && Cloud.server === server
        && Cloud.uid === uid && Cloud.authGeneration === generation;
    localStorage.setItem(key, JSON.stringify({ groupId, uid: Cloud.uid, queuedAt: Date.now() }));
    groupJoined = false;
    groupSyncAvailable = false;
    Cloud.invalidateProfileReads();
    try { await clearPendingLiveLocation(); }
    catch (error) { reportPendingLiveLocationStorageError(error); }
    if (!isCurrent()) return;
    if (groupInfo && !groupChoices.some(group => group.id === groupId)) groupChoices.push(groupInfo);
    groupInfo = null;
    myLiveRecordId = null;
    localStorage.removeItem('mtb_pro_group_joined');
    localStorage.removeItem('mtb_pro_group_code');
    if (friendsTimer) { clearInterval(friendsTimer); friendsTimer = null; }
    renderGroupState(false);
    renderFriends();
    if (currentPage === 2) loadGroupRankings();
    renderAccount();
    if (!navigator.onLine) {
        $('group-status').textContent = 'Has salido en este dispositivo; la salida del servidor está pendiente de conexión.';
        toast('Has salido en este dispositivo. La salida del servidor se completará al recuperar conexión.', 6000);
        return;
    }
    try {
        const leaveCompleted = await syncPendingGroupLeave();
        if (!isCurrent()) return;
        if (leaveCompleted) {
            toast('Has salido del grupo. Conservas el acceso para volver a entrar.');
        } else {
            $('group-status').textContent = 'Has salido en este dispositivo; se completará la salida del servidor al recuperar conexión.';
            toast('Has salido en este dispositivo; la salida del servidor queda pendiente de conexión.', 6000);
        }
    } catch (e) {
        if (!isCurrent()) return;
        localStorage.removeItem('mtb_pro_group_code');
        renderAccount();
        $('group-status').textContent = 'Has salido en este dispositivo; se completará la salida del servidor al recuperar conexión.';
        console.warn('No se pudo confirmar la salida del grupo:', e);
        toast('Has salido en este dispositivo; la salida del servidor queda pendiente de conexión.', 6000);
    }
}
$('btn-leave').addEventListener('click', leaveGroupLocally);

// ============================================================

// ============================================================

window.addEventListener('online', restoreGroup);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (hasPendingGroupLeave()) restoreGroup();
    else if (groupJoined) {
        refreshFriends();
        if (isRecording && !isPaused) publishMyLocation(true);
    }
});
