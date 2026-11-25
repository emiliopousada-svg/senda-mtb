'use strict';

// Group ranking display, publishing, and offline deletion sync.
let groupRankingDeletesSyncing = false;
let groupRankingMembers = [];
const GROUP_RANKING_MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

function renderGroupMetricRanking(containerId, key, format) {
    const container = $(containerId);
    if (!container) return;
    container.replaceChildren();
    const entries = groupRankingMembers
        .filter(member => Number.isFinite(Number(member[key])) && Number(member[key]) > 0)
        .sort((a, b) => Number(b[key]) - Number(a[key]))
        .slice(0, GROUP_RANKING_MEDALS.length);
    GROUP_RANKING_MEDALS.forEach((medalSymbol, index) => {
        const member = entries[index] || null;
        const row = document.createElement('div');
        row.className = `group-ranking-item${member ? '' : ' is-empty'}`;
        const position = document.createElement('div');
        position.className = 'group-ranking-position';
        const medal = document.createElement('span');
        medal.className = 'group-ranking-medal';
        medal.setAttribute('role', 'img');
        medal.setAttribute('aria-label', `Puesto ${index + 1}`);
        medal.textContent = medalSymbol;
        const place = document.createElement('span');
        place.className = 'group-ranking-place';
        place.textContent = `${index + 1}.º`;
        position.append(medal, place);
        const name = document.createElement('span');
        name.className = 'group-ranking-name';
        name.textContent = member ? member.nickname || 'Ciclista' : '—';
        const value = document.createElement('strong');
        value.textContent = member ? format(member) : 'Sin marca';
        row.append(position, name, value);
        container.appendChild(row);
    });
}

function renderGroupRankingPending(containerId, message) {
    const container = $(containerId);
    if (!container) return;
    container.replaceChildren();
    const note = document.createElement('p');
    note.className = 'community-ranking-pending';
    note.textContent = message;
    container.appendChild(note);
}

function renderCommunityCompetitionStatus(message, isError = false) {
    const competitionStatus = $('community-competition-status');
    if (!competitionStatus) return;
    competitionStatus.textContent = message;
    competitionStatus.classList.toggle('error', isError);
}

async function loadGroupRankings() {
    const status = $('group-ranking-status');
    if (!Cloud.loggedIn() || !groupJoined) {
        groupRankingMembers = [];
        renderGroupMetricRanking('group-ranking-distance', 'maxDistanceKm', () => '');
        renderGroupMetricRanking('group-ranking-ascent', 'maxElevationGainM', () => '');
        renderGroupMetricRanking('group-ranking-speed', 'maxSpeedKmh', () => '');
        renderGroupMetricRanking('group-ranking-time', 'bestMovingTimeSec', () => '');
        renderGroupMetricRanking('group-ranking-consistency', 'activityCount', () => '');
        renderGroupMetricRanking('group-ranking-points', 'leaguePoints', () => '');
        renderGroupRankingPending('group-ranking-segments', 'Se activará al unirte a un grupo.');
        const message = 'Inicia sesión y únete a un grupo para consultar la temporada activa.';
        status.textContent = message;
        renderCommunityCompetitionStatus(message);
        if (typeof refreshCommunityLeague === 'function') refreshCommunityLeague();
        return;
    }
    status.classList.remove('error');
    status.textContent = 'Cargando marcas del grupo…';
    renderCommunityCompetitionStatus('Consultando la temporada activa…');
    groupRankingMembers = [];
    renderGroupMetricRanking('group-ranking-distance', 'maxDistanceKm', () => '');
    renderGroupMetricRanking('group-ranking-ascent', 'maxElevationGainM', () => '');
    renderGroupMetricRanking('group-ranking-speed', 'maxSpeedKmh', () => '');
    renderGroupMetricRanking('group-ranking-time', 'bestMovingTimeSec', () => '');
    renderGroupMetricRanking('group-ranking-consistency', 'activityCount', () => '');
    renderGroupMetricRanking('group-ranking-points', 'leaguePoints', () => '');
    renderGroupRankingPending('group-ranking-segments', 'Cargando segmentos…');
    const requestedGroupId = groupName();
    try {
        const result = await cloudApi('/api/mtb/groups/rankings');
        if (groupName() !== requestedGroupId) return;
        groupRankingMembers = Array.isArray(result.members) ? result.members : [];
        renderGroupMetricRanking('group-ranking-distance', 'maxDistanceKm', member => {
            const duration = Number(member.distanceMovingTimeSec);
            return `${Number(member.maxDistanceKm).toFixed(1)} km${duration > 0 ? ` · ${fmtDur(duration)}` : ''}`;
        });
        renderGroupMetricRanking('group-ranking-ascent', 'maxElevationGainM', member => `+${Math.round(Number(member.maxElevationGainM))} m`);
        renderGroupMetricRanking('group-ranking-speed', 'maxSpeedKmh', member => `${Number(member.maxSpeedKmh).toFixed(1)} km/h`);
        renderGroupMetricRanking('group-ranking-time', 'bestMovingTimeSec', member => fmtDur(Number(member.bestMovingTimeSec)));
        renderGroupMetricRanking('group-ranking-consistency', 'activityCount', member => `${member.activityCount} ${member.activityCount === 1 ? 'salida' : 'salidas'}`);
        renderGroupMetricRanking('group-ranking-points', 'leaguePoints', member => `${Math.round(Number(member.leaguePoints))} pts`);
        if (groupRankingMembers.some(member => Number(member.segmentLeads) > 0)) {
            renderGroupMetricRanking('group-ranking-segments', 'segmentLeads', member => `${member.segmentLeads} ${Number(member.segmentLeads) === 1 ? 'segmento liderado' : 'segmentos liderados'}`);
        } else {
            renderGroupRankingPending('group-ranking-segments', 'Nadie del grupo tiene tiempos en segmentos. Recorre un segmento comunitario para estrenar esta categoría.');
        }

        const seasonText = result.season
            ? ` · Temporada ${result.season.seasonNumber} (Semana ${result.season.currentWeek}/4)`
            : ' · clasificación del grupo';
        status.textContent = `${result.group.name}${seasonText}`;
        renderCommunityCompetitionStatus(result.season
            ? `${result.group.name} · Temporada ${result.season.seasonNumber}, semana ${result.season.currentWeek}/4 · ${result.season.daysRemaining} días restantes.`
            : `La clasificación de ${result.group.name} está disponible.`);
    } catch (error) {
        if (groupName() !== requestedGroupId) return;
        console.warn('No se pudo cargar el ranking del grupo:', error);
        const message = error.status === 404
            ? 'El servidor no tiene el ranking del grupo. Copia pb_hooks/ y pb_migrations/ en PocketBase y reinícialo.'
            : `No se pudo cargar el ranking: ${error.message || 'error de conexión'}`;
        status.textContent = message;
        status.classList.add('error');
        renderCommunityCompetitionStatus(message, true);
    } finally {
        if (typeof refreshCommunityLeague === 'function') refreshCommunityLeague();
    }
}

async function shareRouteToGroupRanking(route, button, options = {}) {
    const automatic = options.automatic === true;
    const server = options.server || Cloud.server;
    const uid = options.uid || Cloud.uid;
    const authGeneration = Cloud.authGeneration;
    const api = options.api || cloudApi;
    const isCurrent = options.isCurrent || (() => Cloud.loggedIn()
        && Cloud.uid === uid && Cloud.server === server && Cloud.authGeneration === authGeneration);
    const activeGroupId = Cloud.groupCode;
    if (!Cloud.loggedIn() || !activeGroupId || (!automatic && !groupJoined)) {
        if (!automatic) toast('Inicia sesión y selecciona un grupo para compartir marcas.');
        return false;
    }
    if (automatic && route && route.groupRankingPending) {
        if (route.groupRankingOwnerId !== uid || route.groupRankingServer !== server) return false;
        if (route.groupRankingGroupId && route.groupRankingGroupId !== activeGroupId) return false;
        if (!route.groupRankingGroupId) {
            const confirmed = await modal({
                message: `Esta actividad quedó pendiente de una versión anterior y no se guardó el grupo de destino. ¿Confirmas compartir sus marcas con «${groupInfo && groupInfo.name ? groupInfo.name : 'tu grupo actual'}»?`,
                ok: 'Confirmar grupo'
            });
            if (!confirmed || !isCurrent()) return false;
        }
    }
    if (!navigator.onLine) {
        if (!automatic) toast('Necesitas conexión para compartir una marca con el grupo.');
        return false;
    }
    if (!route || route.kind !== 'recorded') {
        if (!automatic) toast('Solo se pueden compartir actividades grabadas.');
        return false;
    }
    if (automatic && route.groupRankingGroupId === activeGroupId
        && route.groupRankingServer === server && !route.groupRankingPending
        && route.groupRankingVerified === true) {
        return true;
    }
    const analysis = typeof statsAnalyzeRoute === 'function' ? statsAnalyzeRoute(route) : null;
    const distanceKm = analysis && Number.isFinite(analysis.distanceKm)
        ? analysis.distanceKm
        : Number(route.distanceKm) || 0;
    const movingTimeSec = analysis && !analysis.movingTimeEstimated && Number.isFinite(analysis.movingTimeSec)
        ? analysis.movingTimeSec
        : Number(route.movingTimeSec) || 0;
    const maxSpeedKmh = analysis && Number.isFinite(analysis.maxSpeed) ? analysis.maxSpeed : 0;
    const elevationGain = analysis && Number.isFinite(analysis.elevationGain)
        ? analysis.elevationGain
        : Number(route.elevationGain) || 0;
    if (distanceKm <= 0 && maxSpeedKmh <= 0) {
        const error = new Error('Esta actividad no tiene marcas válidas para compartir.');
        if (automatic) throw error;
        toast(error.message);
        return false;
    }
    const details = [];
    if (distanceKm > 0) details.push(`Distancia: ${distanceKm.toFixed(1)} km`);
    if (elevationGain > 0) details.push(`Desnivel positivo: +${Math.round(elevationGain)} m`);
    if (movingTimeSec > 0) details.push(`Tiempo en movimiento: ${fmtDur(movingTimeSec)}`);
    if (maxSpeedKmh > 0) details.push(`Velocidad punta: ${maxSpeedKmh.toFixed(1)} km/h`);
    if (button) button.disabled = true;
    try {
        if (!automatic) {
            const confirmed = await modal({
                message: `Compartir con «${groupInfo && groupInfo.name ? groupInfo.name : 'el grupo'}» estas marcas de la actividad:\n\n${details.join('\n')}\n\nEl servidor verificará las marcas con el trazado de la ruta sincronizada. El grupo solo verá las métricas; no se publicarán el trazado GPS, el nombre ni la ubicación.`,
                ok: 'Compartir marcas'
            });
            if (!confirmed) return false;
        }
        if (!isCurrent()) return false;
        const clientId = Number(route.id);
        if (!Number.isSafeInteger(clientId) || clientId <= 0) {
            throw new Error('No se pudo identificar esta actividad para el ranking.');
        }
        const previousRankingOwnerId = route.groupRankingOwnerId;
        const previousRankingServer = route.groupRankingServer;
        const previousRankingGroupId = route.groupRankingGroupId;
        const previousRankingPending = route.groupRankingPending;
        route.groupRankingOwnerId = uid;
        route.groupRankingServer = server;
        route.groupRankingGroupId = activeGroupId;
        route.groupRankingPending = true;
        try {
            await DB.put(route);
        } catch (error) {
            if (previousRankingOwnerId === undefined) delete route.groupRankingOwnerId;
            else route.groupRankingOwnerId = previousRankingOwnerId;
            if (previousRankingServer === undefined) delete route.groupRankingServer;
            else route.groupRankingServer = previousRankingServer;
            if (previousRankingGroupId === undefined) delete route.groupRankingGroupId;
            else route.groupRankingGroupId = previousRankingGroupId;
            if (previousRankingPending === undefined) delete route.groupRankingPending;
            else route.groupRankingPending = previousRankingPending;
            throw error;
        }
        if (!isCurrent()) return false;
        const result = await api('/api/mtb/groups/rankings/share', 'POST', { clientId });
        if (!isCurrent()) return false;
        route.groupRankingGroupId = activeGroupId;
        route.groupRankingVerified = true;
        route.groupRankingPending = false;
        try {
            await DB.put(route);
        } catch (error) {
            route.groupRankingGroupId = activeGroupId;
            route.groupRankingPending = true;
            throw error;
        }
        if (!isCurrent()) return false;
        const records = [];
        if (result.newDistanceRecord) records.push('nueva actividad más larga');
        if (result.newAscentRecord) records.push('mayor desnivel');
        if (result.newTimeRecord) records.push('mayor tiempo en movimiento');
        if (result.newSpeedRecord) records.push('nueva velocidad punta');
        toast(automatic
            ? `Marcas añadidas automáticamente al ranking de ${groupInfo?.name || 'tu grupo'}.`
            : records.length ? `Marca compartida: ${records.join(' y ')}.` : 'Marcas compartidas; ya conservabas un mejor récord.');
        if (currentPage === 2 && isCurrent()) await loadGroupRankings();
        return true;
    } catch (error) {
        console.warn('No se pudieron compartir las marcas con el grupo:', error);
        if (automatic) throw error;
        toast(error.status === 404
            ? 'El servidor no tiene el ranking del grupo. Copia pb_hooks/ y pb_migrations/ en PocketBase y reinícialo.'
            : `No se pudieron compartir las marcas: ${error.message || 'error de conexión'}`, 6000);
        return false;
    } finally {
        if (button) button.disabled = false;
    }
}

async function syncPendingGroupRankingDeletes(options = {}) {
    const server = options.server || Cloud.server;
    const uid = options.uid || Cloud.uid;
    const authGeneration = options.authGeneration === undefined
        ? Cloud.authGeneration
        : options.authGeneration;
    const isCurrent = options.isCurrent || (() => Cloud.loggedIn()
        && Cloud.uid === uid && Cloud.server === server
        && Cloud.authGeneration === authGeneration);
    const api = options.api || ((path, method, body, apiOptions) => {
        if (!isCurrent()) return Promise.resolve(null);
        const requestOptions = apiOptions && typeof apiOptions === 'object' ? apiOptions : {};
        return cloudApi(path, method, body, { ...requestOptions, server });
    });
    if (!Cloud.loggedIn() || !navigator.onLine || groupRankingDeletesSyncing) return false;
    groupRankingDeletesSyncing = true;
    let pending;
    try {
        pending = await DB.kvGet('pendingGroupRankingDeletes') || [];
    } catch (error) {
        console.warn('No se pudo leer la cola de borrados del ranking:', error);
        groupRankingDeletesSyncing = false;
        return false;
    }
    if (!Array.isArray(pending)) {
        console.warn('La cola de borrados del ranking tiene un formato no válido.');
        groupRankingDeletesSyncing = false;
        return false;
    }

    const remaining = [];
    let failed = false;
    for (const item of pending) {
        if (!isCurrent()) {
            groupRankingDeletesSyncing = false;
            return false;
        }
        if (!item || item.ownerId !== uid || item.server !== server) {
            remaining.push(item);
            continue;
        }
        try {
            await api('/api/mtb/groups/rankings/delete', 'POST', { clientId: item.clientId });
            if (!isCurrent()) {
                groupRankingDeletesSyncing = false;
                return false;
            }
        } catch (error) {
            if (!isCurrent()) {
                groupRankingDeletesSyncing = false;
                return false;
            }
            failed = true;
            remaining.push(item);
            console.warn(`No se pudo retirar del ranking la actividad ${item.clientId}:`, error);
        }
    }
    if (!isCurrent()) {
        groupRankingDeletesSyncing = false;
        return false;
    }
    try {
        await DB.kvSet('pendingGroupRankingDeletes', remaining);
        if (!isCurrent()) return false;
    } catch (error) {
        failed = true;
        console.warn('No se pudo guardar la cola de borrados del ranking:', error);
    } finally {
        groupRankingDeletesSyncing = false;
    }
    if (failed) toast('La ruta se borró, pero su marca del ranking sigue pendiente de sincronizar.', 6000);
    return !failed;
}
