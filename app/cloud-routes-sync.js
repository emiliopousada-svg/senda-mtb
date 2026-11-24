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

async function flushPendingDeletes({ isCurrentSync, syncCloudApi, noteSyncFailure }) {
    let pendingDeletes = [];
    let pendingDeletesAvailable = true;
    try {
        pendingDeletes = (await DB.kvGet('pendingDeletes')) || [];
        if (!isCurrentSync()) return null;
    } catch (error) {
        if (!isCurrentSync()) return null;
        pendingDeletesAvailable = false;
        noteSyncFailure(`No se pudo leer la cola de borrados: ${error.message}`);
        console.warn('No se pudo leer la cola de borrados:', error);
    }

    const remaining = [];
    for (const remoteId of pendingDeletes) {
        if (!isCurrentSync()) return null;
        try {
            await syncCloudApi(`/api/collections/routes/records/${remoteId}`, 'DELETE');
        } catch (error) {
            if (!isCurrentSync()) return null;
            if (error.status !== 404) {
                remaining.push(remoteId);
                noteSyncFailure(`No se pudo borrar una ruta del servidor: ${error.message}`, error);
                console.warn(`No se pudo borrar la ruta remota ${remoteId}:`, error);
            }
        }
        if (!isCurrentSync()) return null;
    }

    if (pendingDeletesAvailable) {
        if (!isCurrentSync()) return null;
        try {
            await DB.kvSet('pendingDeletes', remaining);
            if (!isCurrentSync()) return null;
        } catch (error) {
            if (!isCurrentSync()) return null;
            noteSyncFailure(`No se pudo guardar la cola de borrados: ${error.message}`);
            console.warn('No se pudo guardar la cola de borrados:', error);
        }
    }
    return new Set(pendingDeletes);
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
    const accountStatus = $('acc-status');
    accountStatus.hidden = false;
    accountStatus.textContent = 'Sincronizando…';
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
                await Cloud.clearSession();
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
            const pendingClientIds = savedRoutes.filter(route => !route.remoteId
                || !route.remoteServer || route.remoteServer !== retryServer)
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
        const skip = await flushPendingDeletes({
            isCurrentSync,
            syncCloudApi,
            noteSyncFailure
        });
        if (!isCurrentSync() || !skip) return;

        // 3) reconciliar lo remoto y subir cambios locales sin bloquear otras rutas
        const byClient = new Map(remote.map(x => [Number(x.clientId), x]));
        const byRemoteId = new Map(remote.map(x => [x.id, x]));
        const blockedIds = new Set();
        for (const r of [...savedRoutes]) {
            if (!isCurrentSync()) return;
            const previousCreator = r.createdBy || '';
            const previousRemoteServer = r.remoteServer || '';
            r.createdBy = nickname;
            const found = byClient.get(r.id);
            const remoteRecord = r.remoteId && (!r.remoteServer || r.remoteServer === retryServer)
                && !skip.has(r.remoteId)
                ? byRemoteId.get(r.remoteId)
                : null;
            const matched = remoteRecord || (found && !skip.has(found.id) ? found : null)
                || (!fullAudit ? pendingRemoteByClient.get(Number(r.id)) : null);

            // Una ruta borrada desde otro dispositivo ya no existe en el inventario remoto.
            let remoteIdOnCurrentServer = Boolean(r.remoteId
                && (r.remoteServer === retryServer || (!r.remoteServer && remoteRecord)));
            if (r.remoteId && !r.remoteServer && !matched) {
                noteSyncFailure(`No se puede reconciliar «${r.name || 'ruta'}»: no se conoce el servidor de origen de su identificador remoto.`);
                blockedIds.add(r.id);
                continue;
            }
            if (remoteIdOnCurrentServer
                && (skip.has(r.remoteId) || (fullAudit && !matched))) {
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
                r.remoteServer = retryServer;
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
                const changed = remoteIdChanged || previousRemoteServer !== retryServer
                    || r.name !== remoteName || r.activityType !== remoteActivity
                    || previousCreator !== remoteCreator;
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
            if (matched) {
                r.remoteId = matched.id;
                r.remoteServer = retryServer;
                remoteIdOnCurrentServer = true;
            }
            if (remoteIdOnCurrentServer && !r.dirty) {
                if (Cloud.groupCode && hasPendingGroupRanking(r)) {
                    await syncRouteRanking(r);
                    if (!isCurrentSync()) return;
                }
                continue;
            }
            try {
                let rec;
                if (remoteIdOnCurrentServer) rec = await syncCloudApi(`/api/collections/routes/records/${r.remoteId}`, 'PATCH', {
                    name: r.name,
                    ...(r.createdBy ? { createdBy: String(r.createdBy).slice(0, ROUTE_NICKNAME_LIMIT) } : {})
                });
                else rec = await syncCloudApi('/api/collections/routes/records', 'POST', routeForm(r), { timeoutMs: 60000 });
                if (!isCurrentSync()) return;
                r.remoteId = rec.id;
                r.remoteServer = retryServer;
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
                if (e.status === 404 && remoteIdOnCurrentServer) {
                    r.remoteId = null;
                    delete r.remoteServer;
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
                        id, remoteId: rec.id, remoteServer: retryServer, dirty: false,
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

        if (pulled > 0 && typeof communityScheduleAutomaticSegmentEffortScan === 'function') {
            communityScheduleAutomaticSegmentEffortScan();
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
