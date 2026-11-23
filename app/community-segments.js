'use strict';

// Segment selection, publication, and rankings.

let communityHubSegmentsLoadId = 0;
let communityAutomaticSegmentEffortScanPromise = null;
let communityAutomaticSegmentEffortScanQueued = false;
let communityAutomaticSegmentEffortFailureNotified = false;

function communityPrepareHubSegments(segments, position) {
    const hasPosition = Array.isArray(position)
        && Number.isFinite(position[0]) && position[0] >= -90 && position[0] <= 90
        && Number.isFinite(position[1]) && position[1] >= -180 && position[1] <= 180;
    return segments.map(segment => {
        const route = segment && segment.expand && segment.expand.route;
        const geometry = communityRecordLines(segment);
        return {
            ...segment,
            communityRouteTitle: String(route && route.title || '').trim() || 'Ruta de la comunidad',
            communityRouteLocation: [route && route.locality, route && route.province].filter(Boolean).join(' · '),
            communityProximityMeters: hasPosition && geometry
                ? communityDistanceToRoute(position, geometry)
                : null
        };
    }).sort((a, b) => {
        if (hasPosition) {
            const distanceA = Number.isFinite(a.communityProximityMeters) ? a.communityProximityMeters : Infinity;
            const distanceB = Number.isFinite(b.communityProximityMeters) ? b.communityProximityMeters : Infinity;
            if (distanceA !== distanceB) return distanceA - distanceB;
        }
        return a.communityRouteTitle.localeCompare(b.communityRouteTitle, 'es')
            || String(a.title || '').localeCompare(String(b.title || ''), 'es');
    });
}

function communityHubSegmentDistanceLabel(distanceMeters) {
    if (!Number.isFinite(distanceMeters)) return '';
    return distanceMeters < 1000
        ? `${Math.round(distanceMeters)} m`
        : `${(distanceMeters / 1000).toFixed(1)} km`;
}

async function communityFindAutomaticSegmentEffortImprovements(activities, segments, existingEfforts, shouldContinue = () => true) {
    const tracks = (Array.isArray(activities) ? activities : [])
        .filter(activity => activity && Array.isArray(activity.points) && activity.points.length > 1);
    const improvements = [];
    let checked = 0;
    for (const segment of Array.isArray(segments) ? segments : []) {
        if (!segment || !segment.id || !shouldContinue()) return null;
        const lines = communityRecordLines(segment);
        if (!lines) continue;
        const existing = existingEfforts.get(segment.id) || null;
        const storedTime = Number(existing && existing.elapsedSeconds);
        let bestTime = Number.isFinite(storedTime) && storedTime > 0 && storedTime <= 86400
            ? storedTime
            : Infinity;
        let bestMatch = null;
        for (const activity of tracks) {
            if (!shouldContinue()) return null;
            const match = MTBCommunityPerformance.matchActivity(activity, lines);
            if (match && Number.isFinite(match.elapsedSeconds)
                && match.elapsedSeconds > 0 && match.elapsedSeconds <= 86400
                && match.elapsedSeconds < bestTime) {
                bestTime = match.elapsedSeconds;
                bestMatch = match;
            }
            checked++;
            if (checked % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (bestMatch) improvements.push({
            segment,
            segmentId: segment.id,
            existing,
            elapsedSeconds: bestTime
        });
    }
    return improvements;
}

async function communityFetchAutomaticEffortRecords(urlForPage, isCurrent) {
    const records = [];
    let page = 1, totalPages = 1;
    do {
        const result = await cloudApi(urlForPage(page));
        if (!isCurrent()) return null;
        if (Array.isArray(result.items)) records.push(...result.items);
        totalPages = Math.max(1, Number(result.totalPages) || 1);
        page++;
    } while (page <= totalPages);
    return records;
}

function communityAutomaticEffortScanSignature(segments, activities, effortsBySegment) {
    const efforts = Array.from(effortsBySegment.entries())
        .map(([segmentId, effort]) => [segmentId, String(effort.id || ''), Number(effort.elapsedSeconds)])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return JSON.stringify({
        segments: segments.map(segment => [
            segment.id, segment.updated || '', String(segment.trackJson || '').length
        ]),
        activities: activities.map(activity => {
            const first = activity.points[0], last = activity.points[activity.points.length - 1];
            return [String(activity.id), activity.points.length,
                first && first[3] || null, last && last[3] || null];
        }),
        efforts
    });
}

async function communityScanAutomaticSegmentEfforts(knownSegments = null) {
    if (!Cloud.loggedIn() || !String(Cloud.nickname || '').trim() || !navigator.onLine) return;
    const uid = Cloud.uid, server = Cloud.server, generation = Cloud.authGeneration;
    const alias = String(Cloud.nickname).trim().slice(0, 32);
    const isCurrent = () => Cloud.loggedIn() && Cloud.uid === uid
        && Cloud.server === server && Cloud.authGeneration === generation;
    const activities = (Array.isArray(savedRoutes) ? savedRoutes : [])
        .filter(activity => activity && activity.kind !== 'imported'
            && Array.isArray(activity.points) && activity.points.length > 1);
    if (!activities.length) return;

    const segments = Array.isArray(knownSegments) ? knownSegments
        : await communityFetchAutomaticEffortRecords(page =>
            `/api/collections/community_segments/records?page=${page}&perPage=50&sort=-id&fields=id,title,trackJson,updated`,
        isCurrent);
    if (!segments || !segments.length || !isCurrent()) return;
    const efforts = await communityFetchAutomaticEffortRecords(page =>
        `${communityRecordCollectionUrl(
            'community_segment_efforts',
            `owner = "${uid}"`,
            'id,owner,segment,alias,elapsedSeconds'
        )}&page=${page}`,
    isCurrent);
    if (!efforts || !isCurrent()) return;

    const effortsBySegment = new Map();
    efforts.forEach(effort => {
        const segmentId = typeof effort.segment === 'string'
            ? effort.segment
            : effort.segment && effort.segment.id;
        if (segmentId) effortsBySegment.set(segmentId, effort);
    });
    const storageKey = `mtb_community_segment_effort_scan_v1_${encodeURIComponent(server)}_${uid}`;
    try {
        if (localStorage.getItem(storageKey)
            === communityAutomaticEffortScanSignature(segments, activities, effortsBySegment)) return;
    } catch (error) {
        console.warn('No se pudo comprobar el estado del análisis de segmentos guardado:', error);
    }

    const improvements = await communityFindAutomaticSegmentEffortImprovements(
        activities, segments, effortsBySegment, isCurrent
    );
    if (!improvements || !isCurrent()) return;
    let updated = 0, failed = 0;
    for (const improvement of improvements) {
        if (!isCurrent()) return;
        const payload = {
            owner: uid,
            segment: improvement.segmentId,
            alias,
            elapsedSeconds: improvement.elapsedSeconds
        };
        try {
            const saved = improvement.existing
                ? await cloudApi(`/api/collections/community_segment_efforts/records/${encodeURIComponent(improvement.existing.id)}`, 'PATCH', {
                    alias,
                    elapsedSeconds: improvement.elapsedSeconds
                })
                : await cloudApi('/api/collections/community_segment_efforts/records', 'POST', payload);
            if (!isCurrent()) return;
            if (!saved || !saved.id) throw new Error('El servidor no devolvió la marca guardada.');
            effortsBySegment.set(improvement.segmentId, saved);
            updated++;
        } catch (error) {
            if (!isCurrent()) return;
            failed++;
            console.warn(`No se pudo guardar el mejor tiempo de «${improvement.segment.title || 'Segmento'}»:`, error);
        }
    }
    if (!isCurrent()) return;
    if (failed === 0) {
        try {
            localStorage.setItem(storageKey,
                communityAutomaticEffortScanSignature(segments, activities, effortsBySegment));
        } catch (error) {
            console.warn('No se pudo guardar el estado del análisis automático de segmentos:', error);
        }
        communityAutomaticSegmentEffortFailureNotified = false;
    } else {
        toast(`No se pudieron guardar ${failed} mejor(es) tiempo(s) de segmentos. Se volverán a comprobar más adelante.`);
    }
    if (updated > 0) {
        toast(`¡Nuevo récord! Se ha actualizado tu mejor tiempo en ${updated} segmento(s).`);
        if (typeof communityDetailRecord !== 'undefined' && communityDetailRecord
            && typeof communityLoadSegments === 'function') {
            communityLoadSegments(communityDetailRecord);
        }
        const section = $('community-section-segments');
        if (section && !section.hidden) communityLoadHubSegments();
    }
}

function communityScheduleAutomaticSegmentEffortScan(knownSegments = null) {
    if (!Cloud.loggedIn() || !String(Cloud.nickname || '').trim() || !navigator.onLine) return;
    if (communityAutomaticSegmentEffortScanPromise) {
        communityAutomaticSegmentEffortScanQueued = true;
        return;
    }
    communityAutomaticSegmentEffortScanPromise = communityScanAutomaticSegmentEfforts(knownSegments)
        .catch(error => {
            console.warn('No se pudieron comprobar automáticamente los tiempos de segmentos:', error);
            if (!communityAutomaticSegmentEffortFailureNotified && Cloud.loggedIn() && navigator.onLine) {
                communityAutomaticSegmentEffortFailureNotified = true;
                toast(`No se pudieron comprobar los segmentos: ${error.message || 'error de conexión'}`);
            }
        })
        .finally(() => {
            communityAutomaticSegmentEffortScanPromise = null;
            if (communityAutomaticSegmentEffortScanQueued) {
                communityAutomaticSegmentEffortScanQueued = false;
                communityScheduleAutomaticSegmentEffortScan();
            }
        });
}

if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', () => communityScheduleAutomaticSegmentEffortScan());
}

async function communityLoadHubSegmentRankings(targets, loadId) {
    if (!targets.length) return;
    let nextTarget = 0;
    const worker = async () => {
        while (loadId === communityHubSegmentsLoadId && nextTarget < targets.length) {
            const target = targets[nextTarget++];
            await communityLoadSegmentRanking(target.segment, target.podiumContainer, target.personalContainer);
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
}

async function communityLoadHubSegments() {
    const list = $('community-hub-segment-list');
    const status = $('community-hub-segments-status');
    const refresh = $('community-hub-segments-refresh');
    if (!list || !status) return;
    const loadId = ++communityHubSegmentsLoadId;
    const server = Cloud.server;
    const isCurrentLoad = () => loadId === communityHubSegmentsLoadId && Cloud.server === server;
    const restartForServerChange = () => {
        if (loadId === communityHubSegmentsLoadId && Cloud.server !== server) {
            communityLoadHubSegments();
            return true;
        }
        return false;
    };
    if (refresh) refresh.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Cargando segmentos comunitarios…';
    list.replaceChildren();
    try {
        if (!navigator.onLine) {
            status.textContent = 'Conéctate para cargar los segmentos comunitarios.';
            status.classList.add('error');
            return;
        }
        const position = Number.isFinite(lastLat) && Number.isFinite(lastLon)
            ? [lastLat, lastLon]
            : null;
        if (!position && typeof requestCurrentGpsFix === 'function') requestCurrentGpsFix();
        const fields = [
            'id', 'owner', 'route', 'title', 'createdBy', 'trackJson', 'distanceKm', 'updated',
            'expand.route.id', 'expand.route.title', 'expand.route.locality', 'expand.route.province'
        ].join(',');
        const segments = [];
        let page = 1, totalPages = 1;
        do {
            const result = await cloudApi(`/api/collections/community_segments/records?page=${page}&perPage=50&sort=-id&expand=route&fields=${fields}`);
            if (!isCurrentLoad()) {
                restartForServerChange();
                return;
            }
            if (Array.isArray(result.items)) segments.push(...result.items);
            totalPages = Math.max(1, Number(result.totalPages) || 1);
            page++;
        } while (page <= totalPages);

        const ordered = communityPrepareHubSegments(segments, position);
        if (!isCurrentLoad()) {
            restartForServerChange();
            return;
        }
        if (!ordered.length) {
            const empty = document.createElement('p');
            empty.className = 'community-empty';
            empty.textContent = 'Todavía no hay segmentos públicos en las rutas de la comunidad.';
            list.replaceChildren(empty);
            status.textContent = 'No hay segmentos comunitarios publicados.';
            return;
        }
        const fragment = document.createDocumentFragment();
        const rankingTargets = [];
        ordered.forEach(segment => {
            const card = document.createElement('article');
            card.className = 'community-hub-segment-item';
            const headingRow = document.createElement('div');
            headingRow.className = 'community-hub-segment-heading';
            const heading = document.createElement('h3');
            heading.className = 'community-hub-segment-title';
            const mapButton = document.createElement('button');
            mapButton.type = 'button';
            mapButton.className = 'community-hub-segment-title-button';
            mapButton.textContent = segment.title || 'Segmento';
            mapButton.setAttribute('aria-label', `Mostrar solo el segmento ${mapButton.textContent} en el mapa`);
            mapButton.addEventListener('click', () => openCommunitySegmentMap(segment));
            heading.appendChild(mapButton);
            headingRow.append(heading);
            const proximity = communityHubSegmentDistanceLabel(segment.communityProximityMeters);
            if (proximity) {
                const badge = document.createElement('span');
                badge.className = 'community-hub-segment-proximity';
                badge.textContent = `${proximity} cerca de ti`;
                headingRow.append(badge);
            }

            const route = document.createElement('div');
            route.className = 'community-hub-segment-route';
            const routeIcon = document.createElement('span');
            routeIcon.className = 'community-hub-segment-route-icon';
            routeIcon.setAttribute('aria-hidden', 'true');
            routeIcon.textContent = '↗';
            const routeCopy = document.createElement('div');
            routeCopy.className = 'community-hub-segment-route-copy';
            const routeLabel = document.createElement('span');
            routeLabel.className = 'community-hub-segment-route-label';
            routeLabel.textContent = 'RUTA';
            const routeTitle = document.createElement('strong');
            routeTitle.textContent = segment.communityRouteTitle;
            routeCopy.append(routeLabel, routeTitle);
            if (segment.communityRouteLocation) {
                const location = document.createElement('span');
                location.className = 'community-hub-segment-location';
                location.textContent = segment.communityRouteLocation;
                routeCopy.append(location);
            }
            route.append(routeIcon, routeCopy);

            const facts = document.createElement('div');
            facts.className = 'community-hub-segment-facts';
            const distanceKm = Number(segment.distanceKm);
            if (Number.isFinite(distanceKm) && distanceKm > 0) {
                const distance = document.createElement('span');
                distance.className = 'community-hub-segment-fact';
                distance.textContent = `${distanceKm.toFixed(2)} km de segmento`;
                facts.append(distance);
            }
            const creator = document.createElement('span');
            creator.className = 'community-hub-segment-fact';
            creator.textContent = `Por ${segment.createdBy || (segment.owner === Cloud.uid ? Cloud.nickname : 'un miembro de la comunidad')}`;
            facts.append(creator);

            const ranking = document.createElement('section');
            ranking.className = 'community-hub-segment-ranking';
            ranking.setAttribute('aria-label', `Clasificación de tiempos: ${segment.title || 'Segmento'}`);
            const rankingHeading = document.createElement('h4');
            rankingHeading.className = 'community-hub-segment-ranking-title';
            rankingHeading.textContent = '🏆 TOP 3 · MEJORES TIEMPOS';
            const rankingList = document.createElement('div');
            rankingList.className = 'community-hub-effort-list';
            const rankingLoading = document.createElement('p');
            rankingLoading.className = 'community-empty';
            rankingLoading.textContent = 'Cargando tiempos…';
            rankingList.append(rankingLoading);
            const personalBest = document.createElement('div');
            personalBest.className = 'community-hub-personal-best';
            const personalLoading = document.createElement('span');
            personalLoading.textContent = 'Cargando tu mejor tiempo…';
            personalBest.append(personalLoading);
            ranking.append(rankingHeading, rankingList, personalBest);

            card.append(headingRow, route, facts, ranking);
            fragment.append(card);
            rankingTargets.push({
                segment,
                podiumContainer: rankingList,
                personalContainer: personalBest
            });
        });
        if (!isCurrentLoad()) {
            restartForServerChange();
            return;
        }
        list.replaceChildren(fragment);
        communityLoadHubSegmentRankings(rankingTargets, loadId);
        communityScheduleAutomaticSegmentEffortScan(segments);
        status.textContent = position
            ? `${ordered.length} segmentos ordenados por cercanía a tu ubicación.`
            : `${ordered.length} segmentos. Activa el GPS para ordenarlos por cercanía; ahora se muestran por ruta.`;
    } catch (error) {
        if (!isCurrentLoad()) {
            restartForServerChange();
            return;
        }
        console.warn('No se pudieron cargar los segmentos comunitarios:', error);
        status.textContent = error.status === 404
            ? 'El servidor aún no tiene la colección community_segments instalada.'
            : `No se pudieron cargar los segmentos: ${error.message || 'error de conexión'}`;
        status.classList.add('error');
    } finally {
        if (loadId === communityHubSegmentsLoadId && refresh) refresh.disabled = false;
    }
}

$('community-hub-segments-refresh')?.addEventListener('click', communityLoadHubSegments);

function communityNearestRoutePoint(latlng, lines) {
    let nearest = null, distance = Infinity;
    lines.forEach((line, lineIndex) => line.forEach((point, pointIndex) => {
        const candidateDistance = communityDistance([latlng.lat, latlng.lng], point);
        if (candidateDistance < distance) {
            distance = candidateDistance;
            nearest = { lineIndex, pointIndex, point, distance: candidateDistance };
        }
    }));
    return nearest;
}

function communityClearSegmentDraftLayers() {
    if (communityPreviewMap) {
        communitySegmentMarkers.forEach(marker => communityPreviewMap.removeLayer(marker));
        if (communitySegmentDraftLayer) communityPreviewMap.removeLayer(communitySegmentDraftLayer);
    }
    communitySegmentMarkers = [];
    communitySegmentDraftLayer = null;
}

function communityCancelSegmentCreation() {
    communitySegmentSelecting = false;
    communitySegmentStart = null;
    communitySegmentGeometry = null;
    communityClearSegmentDraftLayers();
    const editor = $('community-segment-editor');
    if (editor) editor.hidden = true;
    const create = $('community-create-segment');
    if (create) create.hidden = !communityDetailRecord || !Cloud.loggedIn() || !navigator.onLine;
    if (communityPreviewMap) communityPreviewMap.getContainer().style.cursor = '';
}

function communityBeginSegmentCreation() {
    if (!Cloud.loggedIn()) {
        toast('Inicia sesión para crear un segmento comunitario.');
        return;
    }
    if (!navigator.onLine || !communityDetailRecord || !communityPreviewMap || !communityDetailLines) {
        toast('Abre una ruta comunitaria con conexión para crear un segmento.');
        return;
    }
    communityClearSegmentDraftLayers();
    communitySegmentStart = null;
    communitySegmentGeometry = null;
    communitySegmentSelecting = true;
    $('community-segment-name').value = '';
    $('community-segment-submit').disabled = true;
    $('community-segment-editor-status').textContent = 'Toca el inicio y después el final del tramo en el mapa.';
    $('community-segment-editor-status').classList.remove('error');
    $('community-segment-editor').hidden = false;
    $('community-create-segment').hidden = true;
    communityPreviewMap.getContainer().style.cursor = 'crosshair';
}

function communityPickSegmentPoint(event) {
    if (!communitySegmentSelecting || !communityDetailLines) return;
    const selected = communityNearestRoutePoint(event.latlng, communityDetailLines);
    const status = $('community-segment-editor-status');
    if (!selected || selected.distance > 60) {
        status.textContent = 'Toca sobre el trazado o a menos de 60 m de él.';
        status.classList.add('error');
        return;
    }
    status.classList.remove('error');
    const marker = L.circleMarker(selected.point, {
        radius: 7, color: '#101010', weight: 2, fillColor: '#168cff', fillOpacity: 1
    }).addTo(communityPreviewMap);
    communitySegmentMarkers.push(marker);
    if (!communitySegmentStart) {
        communitySegmentStart = selected;
        status.textContent = 'Inicio seleccionado. Toca ahora el final del segmento.';
        return;
    }
    if (selected.lineIndex !== communitySegmentStart.lineIndex) {
        communityPreviewMap.removeLayer(marker);
        communitySegmentMarkers.pop();
        status.textContent = 'El inicio y el final deben estar en el mismo tramo continuo de la ruta.';
        status.classList.add('error');
        return;
    }
    const from = communitySegmentStart.pointIndex;
    const to = selected.pointIndex;
    const line = communityDetailLines[selected.lineIndex];
    const geometry = from <= to ? line.slice(from, to + 1) : line.slice(to, from + 1).reverse();
    let lengthM = 0;
    for (let i = 1; i < geometry.length; i++) {
        lengthM += MTBCommunityPerformance.distanceMeters(geometry[i - 1], geometry[i]);
    }
    if (!Number.isFinite(lengthM) || lengthM < 100) {
        communityPreviewMap.removeLayer(marker);
        communitySegmentMarkers.pop();
        status.textContent = 'El segmento debe medir al menos 100 m. Selecciona un final más alejado.';
        status.classList.add('error');
        return;
    }
    communitySegmentGeometry = geometry;
    communitySegmentDraftLayer = L.polyline(geometry, {
        color: '#168cff', weight: 8, opacity: 0.9, dashArray: '8 6'
    }).addTo(communityPreviewMap);
    communitySegmentSelecting = false;
    communityPreviewMap.getContainer().style.cursor = '';
    status.textContent = `Tramo seleccionado: ${(lengthM / 1000).toFixed(2)} km.`;
    $('community-segment-submit').disabled = false;
}

async function communitySubmitSegment() {
    if (!Cloud.loggedIn() || !communityDetailRecord || !communitySegmentGeometry) return;
    const title = $('community-segment-name').value.trim().slice(0, 60);
    const status = $('community-segment-editor-status');
    if (title.length < 3) {
        status.textContent = 'Escribe un nombre de al menos 3 caracteres.';
        status.classList.add('error');
        return;
    }
    const lengthM = communitySegmentGeometry.slice(1).reduce((sum, point, index) =>
        sum + MTBCommunityPerformance.distanceMeters(communitySegmentGeometry[index], point), 0);
    const button = $('community-segment-submit');
    button.disabled = true;
    status.textContent = 'Publicando el segmento…';
    try {
        await cloudApi('/api/collections/community_segments/records', 'POST', {
            owner: Cloud.uid,
            route: communityDetailRecord.id,
            title,
            createdBy: Cloud.nickname,
            trackJson: JSON.stringify([communitySegmentGeometry]),
            distanceKm: +(lengthM / 1000).toFixed(3)
        });
        communityScheduleAutomaticSegmentEffortScan();
        status.textContent = 'Segmento publicado y añadido a esta ruta.';
        communityCancelSegmentCreation();
        toast('Segmento añadido a la ruta comunitaria.');
        communityLoadSegments(communityDetailRecord);
    } catch (error) {
        console.warn('No se pudo publicar el segmento comunitario:', error);
        status.textContent = error.status === 404
            ? 'Faltan las colecciones community_performance.json en PocketBase.'
            : `No se pudo publicar el segmento: ${error.message || 'error de conexión'}`;
        status.classList.add('error');
        button.disabled = false;
    }
}

async function communityDeleteSegment(segment) {
    if (!Cloud.loggedIn() || segment.owner !== Cloud.uid) return;
    const confirmed = await modal({
        message: `¿Eliminar «${segment.title}» y su clasificación? Solo se eliminará este segmento de la comunidad.`,
        ok: 'Eliminar'
    });
    if (!confirmed) return;
    try {
        await cloudApi(`/api/collections/community_segments/records/${encodeURIComponent(segment.id)}`, 'DELETE');
        communityLoadSegments(communityDetailRecord);
    } catch (error) {
        console.warn('No se pudo eliminar el segmento comunitario:', error);
        communitySetStatus(`No se pudo eliminar el segmento: ${error.message || 'error de conexión'}`, true);
    }
}

async function communityLoadSegments(record) {
    if (!communityDetailRecord || communityDetailRecord.id !== record.id) return;
    const list = $('community-segment-list');
    list.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'community-empty';
    loading.textContent = 'Cargando segmentos…';
    list.append(loading);
    try {
        const filter = `route = "${record.id}"`;
        const result = await cloudApi(communityRecordCollectionUrl(
            'community_segments', filter, 'id,owner,route,title,createdBy,trackJson,distanceKm', '-id'
        ));
        if (!communityDetailRecord || communityDetailRecord.id !== record.id) return;
        const segments = Array.isArray(result.items) ? result.items : [];
        list.replaceChildren();
        if (!segments.length) {
            const empty = document.createElement('p');
            empty.className = 'community-empty';
            empty.textContent = 'Aún no hay segmentos. Puedes crear uno seleccionando el inicio y el final en el mapa.';
            list.append(empty);
            return;
        }
        segments.forEach(segment => {
            const card = document.createElement('article');
            card.className = 'community-segment-item';
            const heading = document.createElement('strong');
            heading.textContent = segment.title || 'Segmento';
            const facts = document.createElement('p');
            facts.textContent = `${(Number(segment.distanceKm) || 0).toFixed(2)} km · creado por ${segment.createdBy || (segment.owner === Cloud.uid ? Cloud.nickname : 'un miembro de la comunidad')}`;
            const ranking = document.createElement('div');
            ranking.className = 'community-ranking-list';
            const personalBest = document.createElement('div');
            personalBest.className = 'community-hub-personal-best';
            card.append(heading, facts, ranking, personalBest);
            list.append(card);
            communityLoadSegmentRanking(segment, ranking, personalBest);
            if (Cloud.loggedIn() && segment.owner === Cloud.uid) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'btn-small danger';
                remove.textContent = 'Eliminar mi segmento';
                remove.addEventListener('click', () => communityDeleteSegment(segment));
                card.append(remove);
            }
        });
    } catch (error) {
        if (!communityDetailRecord || communityDetailRecord.id !== record.id) return;
        console.warn('No se pudieron cargar los segmentos comunitarios:', error);
        loading.textContent = error.status === 404
            ? 'Faltan las colecciones community_performance.json en PocketBase.'
            : `No se pudieron cargar los segmentos: ${error.message || 'error de conexión'}`;
        loading.classList.add('error');
    }
}
