'use strict';

// RUTAS PÚBLICAS DE LA COMUNIDAD
const COMMUNITY_AUTONOMOUS_COMMUNITIES = [
    'Andalucía', 'Aragón', 'Asturias', 'Canarias', 'Cantabria',
    'Castilla-La Mancha', 'Castilla y León', 'Cataluña', 'Ceuta',
    'Comunidad de Madrid', 'Comunidad Foral de Navarra', 'Comunidad Valenciana',
    'Extremadura', 'Galicia', 'Illes Balears', 'La Rioja', 'Melilla',
    'País Vasco', 'Región de Murcia'
];
const COMMUNITY_PROVINCE_TO_AUTONOMY = {
    'A Coruña': 'Galicia',
    'Álava': 'País Vasco',
    'Albacete': 'Castilla-La Mancha',
    'Alicante': 'Comunidad Valenciana',
    'Almería': 'Andalucía',
    'Asturias': 'Asturias',
    'Ávila': 'Castilla y León',
    'Badajoz': 'Extremadura',
    'Barcelona': 'Cataluña',
    'Burgos': 'Castilla y León',
    'Cáceres': 'Extremadura',
    'Cádiz': 'Andalucía',
    'Cantabria': 'Cantabria',
    'Castellón': 'Comunidad Valenciana',
    'Ciudad Real': 'Castilla-La Mancha',
    'Córdoba': 'Andalucía',
    'Cuenca': 'Castilla-La Mancha',
    'Girona': 'Cataluña',
    'Granada': 'Andalucía',
    'Guadalajara': 'Castilla-La Mancha',
    'Gipuzkoa': 'País Vasco',
    'Huelva': 'Andalucía',
    'Huesca': 'Aragón',
    'Illes Balears': 'Illes Balears',
    'Jaén': 'Andalucía',
    'La Rioja': 'La Rioja',
    'Las Palmas': 'Canarias',
    'León': 'Castilla y León',
    'Lleida': 'Cataluña',
    'Lugo': 'Galicia',
    'Madrid': 'Comunidad de Madrid',
    'Málaga': 'Andalucía',
    'Murcia': 'Región de Murcia',
    'Navarra': 'Comunidad Foral de Navarra',
    'Ourense': 'Galicia',
    'Palencia': 'Castilla y León',
    'Pontevedra': 'Galicia',
    'Salamanca': 'Castilla y León',
    'Santa Cruz de Tenerife': 'Canarias',
    'Segovia': 'Castilla y León',
    'Sevilla': 'Andalucía',
    'Soria': 'Castilla y León',
    'Tarragona': 'Cataluña',
    'Teruel': 'Aragón',
    'Toledo': 'Castilla-La Mancha',
    'Valencia': 'Comunidad Valenciana',
    'Valladolid': 'Castilla y León',
    'Bizkaia': 'País Vasco',
    'Zamora': 'Castilla y León',
    'Zaragoza': 'Aragón'
};

const COMMUNITY_TRIM_METERS = 150;
const COMMUNITY_ELEVATION_SIMPLIFY_TOLERANCE_M = 5;
const COMMUNITY_PAGE_SIZE = 100;
const COMMUNITY_MAX_RESULTS = 20;
const COMMUNITY_TRACK_BATCH_SIZE = 5;
const COMMUNITY_MAX_TRACKS_TO_CHECK = 40;
const COMMUNITY_MAX_METADATA_CANDIDATES = 2000;
const COMMUNITY_MAX_TRACK_JSON_CHARS = 262144;
const COMMUNITY_SEARCH_CACHE_KEY = 'community-nearby-search-v4';
const COMMUNITY_SEARCH_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const COMMUNITY_MAX_PUBLISHED_TRACK_POINTS = 3000;
const COMMUNITY_TOTAL_COUNT_CACHE_KEY = 'community-published-total-v1';
const COMMUNITY_DIFFICULTIES = {
    easy: 'Fácil',
    moderate: 'Moderada',
    hard: 'Difícil',
    'very-hard': 'Muy difícil'
};
let communityShareRoute = null;
let communityPublishing = false;
let communityCatalogRoutes = [];
let communityPublishedTotal = 0;
let communityPublishedCountServer = '';
let communityPublishedCountRequest = 0;
let communitySearchActive = false;
let communitySearchRequest = 0;
let communityVisibleLayers = new Map();
let communityLayerGroup = null;
let communityPreviewMap = null;
let communityPreviewBaseLayer = null;
let communityPreviewRouteLayer = null;
let communityPreviewPoiLayer = null;
let communitySegmentPreviewMap = null;
let communitySegmentPreviewBaseLayer = null;
let communitySegmentPreviewLayer = null;
let communityDetailBackAction = openCommunityCatalog;
let communityDetailFollowAction = null;
let communityDetailTapReturnMode = 'none';
let communityDetailRecord = null;
let communityDetailLines = null;
let communitySegmentSelecting = false;
let communitySegmentStart = null;
let communitySegmentGeometry = null;
let communitySegmentMarkers = [];
let communitySegmentDraftLayer = null;

function communitySetStatus(message, isError = false) {
    ['community-status', 'community-modal-status'].forEach(id => {
        const status = $(id);
        status.textContent = message;
        status.classList.toggle('error', isError);
    });
}

function updateCommunityRoutesCount() {
    $('routes-count-community').textContent = String(Math.max(0, communityPublishedTotal));
}

function communityFillActivities(select) {
    select.replaceChildren(new Option('Todas las actividades', ''));
    Object.entries(ACTIVITY_TYPES).forEach(([type, activity]) => {
        if (activity.legacy) return;
        select.add(new Option(`${activity.icon} ${activity.label}`, type));
    });
}

function communityAutonomousCommunity(value) {
    const place = String(value || '').trim();
    return COMMUNITY_PROVINCE_TO_AUTONOMY[place] || place;
}

function communityFillAutonomousCommunities(select, placeholder = 'Elige una comunidad autónoma') {
    const options = COMMUNITY_AUTONOMOUS_COMMUNITIES.map(community => new Option(community, community));
    if (placeholder) options.unshift(new Option(placeholder, ''));
    select.replaceChildren(...options);
}

function communityAutonomousCommunityFilter(community) {
    const provinces = Object.entries(COMMUNITY_PROVINCE_TO_AUTONOMY)
        .filter(([, autonomousCommunity]) => autonomousCommunity === community)
        .map(([province]) => province);
    const values = [community, ...provinces];
    return `(${values.map(value => `province = "${escapeCommunityFilterValue(value)}"`).join(' || ')})`;
}

function communityNicknameKey(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .normalize('NFKC')
        .toLowerCase()
        .normalize('NFKC');
}

async function refreshCommunityPublishedCount() {
    if (!Cloud.loggedIn()) return;
    const requestId = ++communityPublishedCountRequest;
    const server = Cloud.server;
    const cacheServer = String(server || '').replace(/\/+$/, '');
    const uid = Cloud.uid;
    const authGeneration = Cloud.authGeneration;
    const cacheKey = `${COMMUNITY_TOTAL_COUNT_CACHE_KEY}:${cacheServer}`;
    const isCurrentSession = () => requestId === communityPublishedCountRequest
        && Cloud.loggedIn()
        && Cloud.server === server
        && Cloud.uid === uid
        && Cloud.authGeneration === authGeneration;

    if (communityPublishedCountServer !== cacheServer) {
        communityPublishedCountServer = cacheServer;
        communityPublishedTotal = 0;
        updateCommunityRoutesCount();
    }
    try {
        const cached = await DB.kvGet(cacheKey);
        if (!isCurrentSession()) return;
        const total = Number(cached && cached.total);
        if (cached && Number.isSafeInteger(total) && total >= 0) {
            communityPublishedTotal = total;
            updateCommunityRoutesCount();
        }
    } catch (error) {
        console.warn('No se pudo leer el total guardado de rutas comunitarias:', error);
    }
    if (navigator.onLine === false) return;

    try {
        const result = await cloudApi('/api/collections/community_routes/records?page=1&perPage=1&fields=id&filter='
            + encodeURIComponent('published = true'));
        if (!isCurrentSession()) return;
        const total = Number(result && result.totalItems);
        if (!Number.isSafeInteger(total) || total < 0) {
            throw new Error('El servidor devolvió un total de rutas no válido.');
        }
        communityPublishedTotal = total;
        updateCommunityRoutesCount();
        DB.kvSet(cacheKey, { total, savedAt: Date.now() })
            .catch(error => console.warn('No se pudo guardar el total de rutas comunitarias:', error));
    } catch (error) {
        if (isCurrentSession()) console.warn('No se pudo actualizar el total de rutas comunitarias:', error);
    }
}

function openCommunityCatalog() {
    if (!requireSignedIn('Inicia sesión o crea una cuenta para ver rutas comunitarias.')) return;
    communityCancelSegmentCreation();
    $('community-publish').hidden = true;
    $('community-detail').hidden = true;
    $('community-segment-map-view').hidden = true;
    closeCommunityDialog();
    setRoutesTab('community');
    $('community-activity').focus();
}

function closeCommunityDialog() {
    communityCancelSegmentCreation();
    $('community-dialog').hidden = true;
    $('community-segment-map-view').hidden = true;
    communityShareRoute = null;
    communityDetailRecord = null;
    communityDetailLines = null;
    communityDetailTapReturnMode = 'none';
    if (communityPreviewPoiLayer) communityPreviewPoiLayer.dispose();
    communityPreviewPoiLayer = null;
    if (typeof routesResetCommunityRouteDetail === 'function') routesResetCommunityRouteDetail();
}

function communityHandleDetailTap(event) {
    if (communityDetailTapReturnMode === 'none') return;
    if (communityDetailTapReturnMode === 'content'
        && event.target.closest('#community-detail-map, #community-detail-custom-actions, #community-detail-follow, #community-close')) return;
    communityDetailBackAction();
}

function communityHandleAccountStateChange() {
    if (Cloud.loggedIn()) return;
    communitySearchActive = false;
    communityCatalogRoutes = [];
    if (map) communityVisibleLayers.forEach(layer => map.removeLayer(layer));
    communityVisibleLayers.clear();
    if (communityDetailRecord || communityShareRoute) closeCommunityDialog();
    if (routesTab === 'community') setRoutesTab('done');
    renderCommunityRoutes([]);
    communitySetStatus('Inicia sesión o crea una cuenta para ver rutas comunitarias.', true);
}

function handleCommunityBackButton() {
    if ($('community-dialog').hidden) return false;
    if (!$('community-detail').hidden) {
        if (communitySegmentSelecting || !$('community-segment-editor').hidden) {
            communityCancelSegmentCreation();
        } else {
            communityDetailBackAction();
        }
        return true;
    }

    if (!$('community-publish').hidden) {
        openCommunityCatalog();
        return true;
    }

    closeCommunityDialog();
    if (currentPage === 3) setRoutesTab('community');
    return true;
}

function openCommunityPublish(route) {
    if (!requireSignedIn('Inicia sesión o crea una cuenta para proponer una ruta a la comunidad.')) return;
    if (!navigator.onLine) {
        toast('Necesitas conexión para enviar una ruta a la comunidad.', 4500);
        return;
    }
    communityShareRoute = route;
    communityCancelSegmentCreation();
    $('community-segment-map-view').hidden = true;
    $('community-detail').hidden = true;
    $('community-publish').hidden = false;
    $('community-title').textContent = 'Publicar ruta en la comunidad';
    $('community-share-title').textContent = route.name || 'Ruta grabada';
    $('community-share-autonomous-community').value = '';
    $('community-share-description').value = route.description || '';
    $('community-share-difficulty').value = '';
    $('community-share-consent').checked = false;
    $('community-submit').disabled = false;
    communitySetStatus('Al enviarla, la ruta aparecerá publicada en el mapa comunitario.');
    $('community-dialog').hidden = false;
    $('community-share-autonomous-community').focus();
}

function communityPerformedDate(route) {
    const timestamp = Date.parse(route && route.startedAt);
    if (!Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

function communityPerformedDateLabel(value) {
    const date = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'No disponible';
    const localDate = `${date}T12:00:00`;
    return Number.isFinite(Date.parse(localDate)) ? fmtDate(localDate) : 'No disponible';
}

function communityStartedAt(value) {
    const date = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const localDate = `${date}T12:00:00`;
    return Number.isFinite(Date.parse(localDate)) ? localDate : null;
}

function openCommunityDetail(record, lines, options = {}) {
    if (record && typeof record.id === 'string'
        && !requireSignedIn('Inicia sesión o crea una cuenta para ver rutas comunitarias.')) return;
    communityCancelSegmentCreation();
    $('community-segment-map-view').hidden = true;
    communityDetailRecord = record && record.id ? record : null;
    communityDetailLines = lines;
    const viewOnly = options.viewOnly === true;
    const returnOnTap = options.returnOnTap === true;
    communityDetailTapReturnMode = viewOnly || returnOnTap ? 'content' : 'none';
    const pois = Array.isArray(options.pois) ? options.pois : communityPoisFromRecord(record);
    $('community-publish').hidden = true;
    $('community-detail').hidden = false;
    $('community-title').textContent = record.title || 'Ruta de la comunidad';
    $('community-detail-back').textContent = options.backLabel || 'Volver a las rutas';
    $('community-detail-back').hidden = viewOnly || returnOnTap;
    const navigationActions = $('community-detail-navigation-actions');
    if (navigationActions) navigationActions.hidden = viewOnly;
    communityDetailBackAction = options.onBack || openCommunityCatalog;
    communityDetailFollowAction = options.onFollow || null;
    $('community-detail-follow').hidden = viewOnly || !communityDetailFollowAction;
    const customActions = $('community-detail-custom-actions');
    customActions.replaceChildren();
    const actions = options.actions || [];
    customActions.hidden = actions.length === 0;
    actions.forEach(([label, callback]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn secondary';
        button.textContent = label;
        button.addEventListener('click', callback);
        customActions.appendChild(button);
    });
    communitySetStatus('');

    const mapContainer = $('community-detail-map');
    const mapEmpty = $('community-detail-map-empty');
    const hasTrack = Array.isArray(lines) && lines.length > 0;
    mapContainer.hidden = !hasTrack;
    if (mapEmpty) mapEmpty.hidden = hasTrack;
    if (!hasTrack) {
        if (communityPreviewRouteLayer) {
            communityPreviewMap.removeLayer(communityPreviewRouteLayer);
            communityPreviewRouteLayer = null;
        }
        if (communityPreviewPoiLayer) {
            communityPreviewPoiLayer.dispose();
            communityPreviewPoiLayer = null;
        }
    }

    const movingTimeSec = Number(record.movingTimeSec);
    const activity = ACTIVITY_TYPES[record.activityType]?.label || record.activityType || 'No disponible';
    const values = [...(options.values || [
        ['Autor', record.createdBy || 'Ciclista'],
        ['Distancia', `${(Number(record.distanceKm) || 0).toFixed(1)} km`],
        ['Desnivel', Number(record.elevationGain) > 0 ? `+${Math.round(Number(record.elevationGain))} m` : 'No disponible'],
        ['Tiempo en movimiento', movingTimeSec > 0 ? fmtDur(movingTimeSec) : 'No disponible'],
        ['Actividad', activity],
        ['Fecha de realización', communityPerformedDateLabel(record.performedAt)],
        ['Comunidad autónoma', communityAutonomousCommunity(record.province) || 'No disponible'],
        ['Localidad', record.locality || 'No disponible'],
        ['Dificultad', COMMUNITY_DIFFICULTIES[record.difficulty] || 'Sin especificar']
    ])];
    if (record.description) values.push(['Descripción', record.description]);
    if (pois.length) values.push(['Fotos y POI', String(pois.length)]);
    const stats = $('community-detail-stats');
    stats.replaceChildren();
    values.forEach(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'community-detail-stat';
        const caption = document.createElement('span');
        caption.textContent = label;
        const detail = document.createElement('strong');
        detail.textContent = value;
        item.append(caption, detail);
        stats.append(item);
    });
    renderCommunityElevationProfile(communityElevationLines(record, lines), record);
    const showCommunityTools = Boolean(communityDetailRecord);
    $('community-social').hidden = !showCommunityTools;
    $('community-segments-section').hidden = !showCommunityTools;
    $('community-create-segment').hidden = !showCommunityTools || !Cloud.loggedIn() || !navigator.onLine;
    $('community-segment-list').replaceChildren();
    if (showCommunityTools) {
        communityLoadSocial(communityDetailRecord);
        communityLoadSegments(communityDetailRecord);
    }

    $('community-dialog').hidden = false;
    setTimeout(() => {
        if (!hasTrack) return;
        try {
            if (!communityPreviewMap) {
                communityPreviewMap = L.map('community-detail-map', { scrollWheelZoom: false });
                const style = selectedMapStyle();
                communityPreviewBaseLayer = !navigator.onLine || style === 'ign'
                    ? createOfflineTileLayer()
                    : createMapStyleLayers()[style];
                communityPreviewBaseLayer.addTo(communityPreviewMap);
            }
            if (communityPreviewRouteLayer) communityPreviewMap.removeLayer(communityPreviewRouteLayer);
            if (communityPreviewPoiLayer) communityPreviewPoiLayer.dispose();
            communityPreviewRouteLayer = L.polyline(lines, {
                color: '#ffad69', weight: 5, opacity: 0.9
            }).addTo(communityPreviewMap);
            communityPreviewPoiLayer = createRoutePoiLayer(communityPreviewMap, pois);
            communityPreviewPoiLayer.addTo();
            communityPreviewMap.off('click', communityPickSegmentPoint);
            communityPreviewMap.on('click', communityPickSegmentPoint);
            communityPreviewMap.invalidateSize({ pan: false });
            const bounds = communityPreviewRouteLayer.getBounds();
            pois.forEach(poi => {
                if (routePoiCoordinatesValid(poi)) bounds.extend([poi.lat, poi.lng]);
            });
            if (bounds.isValid()) communityPreviewMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
        } catch (error) {
            console.warn('No se pudo mostrar el mapa de detalle comunitario:', error);
            $('community-detail-map').textContent = 'No se pudo cargar el mapa de esta ruta.';
        }
    }, 0);
}

function openCommunitySegmentMap(segment) {
    const lines = communityRecordLines(segment);
    if (!lines) {
        toast('No se puede mostrar este segmento porque su trazado no es válido.');
        return;
    }

    communityCancelSegmentCreation();
    $('community-detail').hidden = true;
    $('community-publish').hidden = true;
    $('community-segment-map-view').hidden = false;
    $('community-title').textContent = segment.title || 'Segmento de la comunidad';
    const status = $('community-segment-map-status');
    status.textContent = 'Se muestra únicamente el trazado de este segmento.';
    status.classList.remove('error');
    $('community-dialog').hidden = false;

    setTimeout(() => {
        try {
            if (!communitySegmentPreviewMap) {
                communitySegmentPreviewMap = L.map('community-segment-map', { scrollWheelZoom: false });
                const style = selectedMapStyle();
                communitySegmentPreviewBaseLayer = !navigator.onLine || style === 'ign'
                    ? createOfflineTileLayer()
                    : createMapStyleLayers()[style];
                communitySegmentPreviewBaseLayer.addTo(communitySegmentPreviewMap);
            }
            if (communitySegmentPreviewLayer) communitySegmentPreviewMap.removeLayer(communitySegmentPreviewLayer);
            communitySegmentPreviewLayer = L.polyline(lines, {
                color: '#ff8a00', weight: 6, opacity: 0.95
            }).addTo(communitySegmentPreviewMap);
            communitySegmentPreviewMap.invalidateSize({ pan: false });
            const bounds = communitySegmentPreviewLayer.getBounds();
            if (bounds.isValid()) {
                communitySegmentPreviewMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
            }
        } catch (error) {
            console.warn('No se pudo mostrar el mapa del segmento comunitario:', error);
            status.textContent = 'No se pudo cargar el mapa de este segmento.';
            status.classList.add('error');
        }
    }, 0);
}

function communityDistance(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(h));
}

function communityRecordLines(record) {
    try {
        const lines = typeof record.trackJson === 'string' ? JSON.parse(record.trackJson) : record.trackJson;
        if (!Array.isArray(lines) || !lines.length || !lines.every(line => Array.isArray(line) && line.length > 1 &&
            line.every(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])))) return null;
        return lines;
    } catch (error) {
        return null;
    }
}

function communityPoisFromRecord(record) {
    if (typeof record?.poisJson === 'string' && !record.poisJson.trim()) return [];
    let pois;
    try {
        pois = typeof record?.poisJson === 'string' ? JSON.parse(record.poisJson) : record?.poisJson;
    } catch (error) {
        console.warn('No se pudieron leer los POI publicados de la ruta:', error);
        return [];
    }
    if (!Array.isArray(pois)) return [];
    const files = Array.isArray(record.poiPhotos) ? record.poiPhotos : (record.poiPhotos ? [record.poiPhotos] : []);
    return pois.flatMap(poi => {
        const lat = Number(poi && poi.lat), lng = Number(poi && poi.lng);
        const photoIndex = Number(poi && poi.photoIndex);
        if (!routePoiCoordinatesValid({ lat, lng }) || !Number.isInteger(photoIndex)
            || photoIndex < 0 || photoIndex >= files.length) return [];
        const file = files[photoIndex];
        if (typeof file !== 'string' || !file) return [];
        return [{
            lat,
            lng,
            caption: String(poi.caption || 'Foto de ruta').slice(0, 100),
            photoUrl: `${Cloud.server}/api/files/community_routes/${encodeURIComponent(record.id)}/${encodeURIComponent(file)}`
        }];
    });
}

function communityDistanceToRoute(position, lines) {
    let nearest = Infinity;
    lines.forEach(line => line.forEach(point => {
        nearest = Math.min(nearest, communityDistance(position, point));
    }));
    return nearest;
}

function communityDistanceToBounds(position, record) {
    const minLat = Number(record.minLat), maxLat = Number(record.maxLat);
    const minLng = Number(record.minLng), maxLng = Number(record.maxLng);
    if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return Infinity;
    const nearest = [
        Math.max(minLat, Math.min(maxLat, position[0])),
        Math.max(minLng, Math.min(maxLng, position[1]))
    ];
    return communityDistance(position, nearest) / 1000;
}

function communityRawSegments(points, includeElevation = false) {
    const lines = [];
    let current = [];
    for (const point of points || []) {
        if (point === null) {
            if (current.length) lines.push(current);
            current = [];
            continue;
        }
        if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
        if (point[5] === 1 && current.length) {
            lines.push(current);
            current = [];
        }
        if (includeElevation) {
            current.push([point[0], point[1], communityElevationValue(point)]);
        } else {
            current.push([point[0], point[1]]);
        }
    }
    if (current.length) lines.push(current);
    return lines.filter(line => line.length > 1);
}

function communityElevationValue(point) {
    if (!Array.isArray(point) || point.length < 3 || point[2] == null || point[2] === '') return null;
    const altitude = Number(point[2]);
    return Number.isFinite(altitude) && altitude >= -500 && altitude <= 9000 ? altitude : null;
}

function communityElevationProfile(lines) {
    const segments = [];
    let distanceM = 0;
    let ascentM = 0;

    for (const line of lines || []) {
        const tracker = MTBStatisticsEngine.createElevationTracker();
        let previousPoint = null;
        let segment = [];
        const finishSegment = () => {
            if (segment.length > 1) segments.push(segment);
            segment = [];
        };

        for (const point of line || []) {
            if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
                tracker.add(null);
                finishSegment();
                previousPoint = null;
                continue;
            }
            if (previousPoint) distanceM += communityDistance(previousPoint, point);
            previousPoint = point;

            const altitude = communityElevationValue(point);
            const smoothedAltitude = altitude !== null
                ? tracker.add(altitude)
                : tracker.add(null);
            if (smoothedAltitude === null) {
                finishSegment();
                continue;
            }
            segment.push({ distanceM, altitude: smoothedAltitude });
        }
        finishSegment();
        ascentM += tracker.gain;
    }

    const samples = segments.flat();
    if (!samples.length) return null;
    return {
        segments,
        distanceM,
        ascentM,
        minAltitude: Math.min(...samples.map(point => point.altitude)),
        maxAltitude: Math.max(...samples.map(point => point.altitude)),
        sampleCount: samples.length
    };
}

function renderCommunityElevationProfile(lines, record = null) {
    const section = $('community-detail-elevation');
    const empty = $('community-detail-elevation-empty');
    const chart = $('community-detail-elevation-chart');
    const area = $('community-detail-elevation-area');
    const profileLine = $('community-detail-elevation-line');
    const summary = $('community-detail-elevation-summary');
    const profile = communityElevationProfile(lines);

    section.hidden = false;
    empty.hidden = Boolean(profile);
    chart.hidden = !profile;
    area.setAttribute('d', '');
    profileLine.setAttribute('d', '');
    summary.textContent = '';
    if (!profile) return;

    const formatMeters = value => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(value);
    const recordedAscent = Number(record && record.elevationGain);
    const ascentM = Number.isFinite(recordedAscent) && recordedAscent > 0
        ? recordedAscent
        : profile.ascentM;
    summary.textContent = `${formatMeters(profile.minAltitude)}–${formatMeters(profile.maxAltitude)} m · +${formatMeters(ascentM)} m`;
    const altitudeRange = Math.max(profile.maxAltitude - profile.minAltitude, 1);
    let sampleIndex = 0;
    const linePaths = [], areaPaths = [];
    profile.segments.forEach(segment => {
        const points = segment.map(point => {
            const index = sampleIndex++;
            const x = profile.distanceM > 0
                ? 8 + point.distanceM / profile.distanceM * 344
                : 8 + index / Math.max(profile.sampleCount - 1, 1) * 344;
            const y = 84 - (point.altitude - profile.minAltitude) / altitudeRange * 68;
            return { x, y };
        });
        const path = points.map((point, index) =>
            `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`
        ).join(' ');
        linePaths.push(path);
        areaPaths.push(`${path} L${points[points.length - 1].x.toFixed(1)},92 L${points[0].x.toFixed(1)},92 Z`);
    });
    profileLine.setAttribute('d', linePaths.join(' '));
    area.setAttribute('d', areaPaths.join(' '));
}

function communityTrimStart(lines, meters) {
    const result = lines.map(line => line.map(point => point.slice()));
    let remaining = meters;
    while (result.length && remaining > 0) {
        const line = result[0];
        if (line.length < 2) { result.shift(); continue; }
        let passed = 0, index = 1;
        while (index < line.length) {
            const length = communityDistance(line[index - 1], line[index]);
            if (passed + length >= remaining) break;
            passed += length;
            index++;
        }
        if (index >= line.length) {
            remaining -= passed;
            result.shift();
            continue;
        }
        const a = line[index - 1], b = line[index];
        const length = communityDistance(a, b) || 1;
        const fraction = Math.max(0, Math.min(1, (remaining - passed) / length));
        const cut = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
        if (a.length > 2 || b.length > 2) {
            const startAltitude = a[2] == null ? null : Number(a[2]);
            const endAltitude = b[2] == null ? null : Number(b[2]);
            cut.push(Number.isFinite(startAltitude) && Number.isFinite(endAltitude)
                ? startAltitude + (endAltitude - startAltitude) * fraction
                : null);
        }
        result[0] = [cut].concat(line.slice(index));
        remaining = 0;
    }
    return result.filter(line => line.length > 1);
}

function communityTrimEnds(lines, meters) {
    const trimmed = communityTrimStart(lines, meters);
    return communityTrimStart(
        trimmed.slice().reverse().map(line => line.slice().reverse()),
        meters
    ).reverse().map(line => line.slice().reverse());
}

function communityElevationLines(record, lines) {
    if (communityElevationProfile(lines)
        || !record || record.owner !== Cloud.uid
        || typeof savedRoutes === 'undefined' || !Array.isArray(savedRoutes)) return lines;

    const localRoute = savedRoutes.find(route => route.communityRouteId === record.id
        && route.kind !== 'community'
        && Array.isArray(route.points)
        && route.points.some(point => Array.isArray(point)
            && Number.isFinite(point[2]) && point[2] >= -500 && point[2] <= 9000));
    if (!localRoute) return lines;

    const localLines = communityRawSegments(localRoute.points, true)
        .map(line => communitySimplify(line, 8))
        .filter(line => line.length > 1);
    const publicLines = communityTrimEnds(localLines, COMMUNITY_TRIM_METERS);
    return communityElevationProfile(publicLines) ? publicLines : lines;
}

function communitySimplify(
    line,
    toleranceMeters,
    elevationToleranceMeters = COMMUNITY_ELEVATION_SIMPLIFY_TOLERANCE_M
) {
    if (line.length <= 2) return line;
    const lat0 = line.reduce((sum, point) => sum + point[0], 0) / line.length;
    const xScale = Math.cos(lat0 * Math.PI / 180) * 111320;
    const project = point => [point[1] * xScale, point[0] * 110540];
    const sqTolerance = toleranceMeters * toleranceMeters;
    const keep = new Uint8Array(line.length);
    const keepElevation = new Uint8Array(line.length);
    const distanceFromStart = new Float64Array(line.length);
    for (let index = 1; index < line.length; index++) {
        distanceFromStart[index] = distanceFromStart[index - 1] + communityDistance(line[index - 1], line[index]);
    }
    keep[0] = keep[line.length - 1] = 1;
    for (let index = 0; index < line.length;) {
        if (communityElevationValue(line[index]) === null) {
            keepElevation[index] = 1;
            while (index < line.length && communityElevationValue(line[index]) === null) index++;
            continue;
        }
        const start = index;
        while (index < line.length && communityElevationValue(line[index]) !== null) index++;
        const end = index - 1;
        keepElevation[start] = keepElevation[end] = 1;
        const elevationStack = [[start, end]];
        while (elevationStack.length) {
            const [first, last] = elevationStack.pop();
            if (last - first < 2) continue;
            const firstAltitude = communityElevationValue(line[first]);
            const lastAltitude = communityElevationValue(line[last]);
            const distanceSpan = distanceFromStart[last] - distanceFromStart[first];
            let maxDeviation = elevationToleranceMeters;
            let maxIndex = -1;
            const midpoint = (first + last) / 2;
            for (let sample = first + 1; sample < last; sample++) {
                const fraction = distanceSpan > 0
                    ? (distanceFromStart[sample] - distanceFromStart[first]) / distanceSpan
                    : (sample - first) / (last - first);
                const expectedAltitude = firstAltitude + (lastAltitude - firstAltitude) * fraction;
                const deviation = Math.abs(communityElevationValue(line[sample]) - expectedAltitude);
                if (deviation > maxDeviation || (maxIndex >= 0 && deviation === maxDeviation
                    && Math.abs(sample - midpoint) < Math.abs(maxIndex - midpoint))) {
                    maxDeviation = deviation;
                    maxIndex = sample;
                }
            }
            if (maxIndex >= 0) {
                keepElevation[maxIndex] = 1;
                elevationStack.push([first, maxIndex], [maxIndex, last]);
            }
        }
    }
    const anchors = [0];
    for (let index = 1; index < line.length - 1; index++) {
        if (keepElevation[index]) {
            keep[index] = 1;
            anchors.push(index);
        }
    }
    anchors.push(line.length - 1);
    const stack = [];
    for (let index = anchors.length - 1; index > 0; index--) {
        stack.push([anchors[index - 1], anchors[index]]);
    }
    while (stack.length) {
        const pair = stack.pop(), first = pair[0], last = pair[1];
        const a = project(line[first]), b = project(line[last]);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        let maxDeviation = 1, maxIndex = -1;
        for (let i = first + 1; i < last; i++) {
            const p = project(line[i]);
            let t = dx || dy ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy) : 0;
            t = Math.max(0, Math.min(1, t));
            const ex = p[0] - (a[0] + t * dx), ey = p[1] - (a[1] + t * dy);
            const d2 = ex * ex + ey * ey;
            const deviation = d2 / sqTolerance;
            if (deviation > maxDeviation) {
                maxDeviation = deviation;
                maxIndex = i;
            }
        }
        if (maxIndex >= 0) {
            keep[maxIndex] = 1;
            stack.push([first, maxIndex], [maxIndex, last]);
        }
    }
    return line.filter((point, index) => keep[index]);
}

function communityUploadTrack(route) {
    // El servidor recorta los extremos antes de guardar; aquí solo reducimos tamaño.
    const sourceLines = communityRawSegments(route.points, true);
    let elevationTolerance = COMMUNITY_ELEVATION_SIMPLIFY_TOLERANCE_M;
    let lines = [];
    let count = 0;
    for (let attempt = 0; attempt < 13; attempt++) {
        lines = sourceLines.map(line => communitySimplify(line, 8, elevationTolerance))
            .filter(line => line.length > 1);
        count = lines.reduce((sum, line) => sum + line.length, 0);
        if (count <= COMMUNITY_MAX_PUBLISHED_TRACK_POINTS) break;
        elevationTolerance *= 2;
    }
    if (count < 2) throw new Error('La ruta no tiene suficientes puntos para compartirla.');
    if (count > COMMUNITY_MAX_PUBLISHED_TRACK_POINTS) {
        throw new Error('No se pudo reducir el track a un tamaño seguro para publicarlo.');
    }
    return lines;
}

function communityTrackBounds(lines) {
    const points = lines.flat();
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (let i = 0; i < points.length; i++) {
        const lat = points[i][0], lng = points[i][1];
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    }
    return { minLat, maxLat, minLng, maxLng };
}

function communityIsDuplicateError(error) {
    return Boolean(error && error.status === 400 && /ya está publicada/i.test(String(error.message || '')));
}

async function submitCommunityRoute() {
    if (!communityShareRoute || !Cloud.loggedIn() || communityPublishing) return;
    const autonomousCommunity = $('community-share-autonomous-community').value;
    if (!autonomousCommunity || !$('community-share-consent').checked) {
        communitySetStatus('Elige la comunidad autónoma y confirma la publicación voluntaria.', true);
        return;
    }
    const button = $('community-submit');
    button.disabled = true;
    communityPublishing = true;
    communitySetStatus('Preparando el trazado y las fotos para publicarlos…');
    try {
        const route = communityShareRoute;
        const formData = new FormData();
        const poiData = communityPublicPoiData(route, formData);
        formData.append('owner', Cloud.uid);
        formData.append('createdBy', Cloud.nickname);
        formData.append('title', String(route.name || 'Ruta MTB').trim().slice(0, 100));
        formData.append('province', autonomousCommunity);
        formData.append('description', String($('community-share-description').value || '').trim().slice(0, 500));
        formData.append('difficulty', $('community-share-difficulty').value);
        formData.append('activityType', activityTypeForRoute(route) || 'mtb');
        const performedAt = communityPerformedDate(route);
        if (performedAt) formData.append('performedAt', performedAt);
        const trackJson = JSON.stringify(communityUploadTrack(route));
        if (trackJson.length > COMMUNITY_MAX_TRACK_JSON_CHARS) {
            throw new Error('El trazado supera el límite de tamaño para publicarlo.');
        }
        formData.append('trackJson', trackJson);
        formData.append('poisJson', poiData.json);
        formData.append('published', 'true');
        if (poiData.skipped) {
            communitySetStatus(`${poiData.count} foto(s) incluidas; ${poiData.skipped} POI se omiten por falta de foto válida o por estar cerca de un extremo.`);
        } else {
            communitySetStatus(`${poiData.count} foto(s) se publicarán junto con la ruta.`);
        }
        const collectionPath = '/api/collections/community_routes/records';
        let record = null;
        if (route.communityRouteId) {
            try {
                record = await cloudApi(`${collectionPath}/${encodeURIComponent(route.communityRouteId)}`, 'PATCH', formData, { timeoutMs: 60000 });
            } catch (error) {
                if (error.status !== 404) throw error;
            }
        }
        if (!record) record = await cloudApi(collectionPath, 'POST', formData, { timeoutMs: 60000 });
        if (!record || typeof record.id !== 'string' || !record.id) {
            throw new Error('El servidor no devolvió el identificador de la ruta publicada.');
        }
        refreshCommunityPublishedCount();
        const previousCommunityRouteId = route.communityRouteId;
        const previousProvince = route.province;
        const previousPerformedAt = route.performedAt;
        route.communityRouteId = record.id;
        route.province = autonomousCommunity;
        if (performedAt) route.performedAt = performedAt;
        try {
            await DB.put(route);
        } catch (error) {
            if (previousCommunityRouteId === undefined) delete route.communityRouteId;
            else route.communityRouteId = previousCommunityRouteId;
            if (previousProvince === undefined) delete route.province;
            else route.province = previousProvince;
            if (previousPerformedAt === undefined) delete route.performedAt;
            else route.performedAt = previousPerformedAt;
            console.warn('La ruta se publicó, pero no se pudo actualizar el contador local:', error);
            communitySetStatus('Ruta publicada, pero no se pudo actualizar el contador en este dispositivo.', true);
            toast('Ruta publicada, pero no se pudo actualizar el contador local.', 6000);
            button.textContent = 'Publicada';
            setTimeout(closeCommunityDialog, 1400);
            return record;
        }
        renderSavedRoutes();
        const refreshCommunitySearch = communitySearchActive;
        const searchRefreshed = refreshCommunitySearch ? await loadCommunityRoutes() : true;
        communitySetStatus(refreshCommunitySearch && !searchRefreshed
            ? 'Ruta publicada. No se pudo actualizar la búsqueda; vuelve a buscar para refrescar el contador.'
            : 'Ruta publicada. Ya aparece en el mapa comunitario.');
        toast(`Ruta publicada${poiData.count ? ` con ${poiData.count} foto(s)` : ''} en la comunidad.`);
        button.textContent = 'Publicada';
        setTimeout(closeCommunityDialog, 1400);
        return record;
    } catch (error) {
        console.warn('No se pudo proponer la ruta a la comunidad:', error);
        if (communityIsDuplicateError(error)) {
            communitySetStatus('Esta ruta ya está publicada en la comunidad; no se admiten duplicados.', true);
            button.disabled = false;
            return null;
        }
        communitySetStatus(error.status === 404
            ? 'Falta instalar la colección community_routes en el servidor. Consulta CONFIGURAR-RUTAS-COMUNIDAD.md.'
            : error.status === 400
                ? `PocketBase rechazó la ruta: ${error.message || 'solicitud no válida'}. Revisa los límites de los campos de community_routes y aplica las migraciones; consulta CONFIGURAR-RUTAS-COMUNIDAD.md.`
                : 'No se pudo enviar la ruta: ' + (error.message || 'error de conexión'), true);
        button.disabled = false;
    } finally {
        communityPublishing = false;
    }
}

async function loadCommunityFavorites() {
    if (!requireSignedIn('Inicia sesión o crea una cuenta para ver rutas comunitarias.')) return false;
    if (!Cloud.loggedIn()) {
        communitySetStatus('Inicia sesión para consultar tus rutas favoritas.', true);
        return;
    }
    if (!navigator.onLine) {
        communitySetStatus('Conéctate para cargar tus rutas favoritas.', true);
        return;
    }
    const button = $('community-favorites-show');
    communitySearchActive = false;
    button.disabled = true;
    communitySetStatus('Cargando tus favoritas…');
    try {
        const filter = `owner = "${Cloud.uid}"`;
        const favoriteUrl = includePerformedAt => {
            const fields = [
                'id', 'route', 'expand.route.id', 'expand.route.owner', 'expand.route.title',
                'expand.route.province', ...(includePerformedAt ? ['expand.route.performedAt'] : []),
                'expand.route.locality', 'expand.route.description', 'expand.route.difficulty',
                'expand.route.activityType', 'expand.route.distanceKm', 'expand.route.elevationGain',
                'expand.route.movingTimeSec', 'expand.route.trackJson', 'expand.route.poisJson',
                'expand.route.poiPhotos'
            ].join(',');
            return `/api/collections/community_route_favorites/records?page=1&perPage=100&expand=route&fields=${fields}&filter=${encodeURIComponent(filter)}`;
        };
        let response;
        try {
            response = await cloudApi(favoriteUrl(true));
        } catch (error) {
            if (error.status !== 400) throw error;
            response = await cloudApi(favoriteUrl(false));
        }
        if (!Cloud.loggedIn()) {
            communityHandleAccountStateChange();
            return false;
        }
        communityCatalogRoutes = (Array.isArray(response.items) ? response.items : [])
            .map(item => item.expand && item.expand.route)
            .filter(record => record && communityRecordLines(record));
        communityCatalogRoutes.forEach(record => { record.proximityKm = null; });
        renderCommunityRoutes(communityCatalogRoutes);
        communitySetStatus(communityCatalogRoutes.length
            ? `${communityCatalogRoutes.length} ruta(s) guardadas en favoritos.`
            : 'Aún no tienes rutas comunitarias favoritas.');
    } catch (error) {
        console.warn('No se pudieron cargar las rutas favoritas:', error);
        communitySetStatus(communitySocialError(error, 'community_route_favorites'), true);
    } finally {
        button.disabled = false;
    }
}

function communityPointsForApp(lines) {
    const points = [];
    lines.forEach(line => line.forEach((coord, index) => {
        points.push([coord[0], coord[1], null, null, null, index === 0 && points.length ? 1 : null]);
    }));
    return points;
}

function communityLocalRoute(record, lines) {
    return {
        id: record.id,
        name: record.title,
        kind: 'community',
        description: record.description || '',
        performedAt: /^\d{4}-\d{2}-\d{2}$/.test(String(record.performedAt || '').slice(0, 10))
            ? String(record.performedAt).slice(0, 10)
            : '',
        province: communityAutonomousCommunity(record.province),
        locality: record.locality || '',
        difficulty: record.difficulty || '',
        points: communityPointsForApp(lines),
        pois: communityPoisFromRecord(record),
        startedAt: communityStartedAt(record.performedAt),
        distanceKm: Number(record.distanceKm) || 0,
        elevationGain: Number(record.elevationGain) || 0,
        activityType: record.activityType || 'mtb'
    };
}

async function saveCommunityOffline(record, lines) {
    if (!requireSignedIn('Inicia sesión o crea una cuenta para guardar rutas comunitarias.')) return false;
    const existing = savedRoutes.find(route => route.communityRouteId === record.id);
    if (existing) {
        toast('Esta ruta ya está guardada en este dispositivo.');
        return;
    }
    const id = Date.now();
    const route = communityLocalRoute(record, lines);
    route.id = id;
    route.communityRouteId = record.id;
    route.kind = 'imported';
    route.movingTimeSec = 0;
    route.dirty = true;
    if (!requireSignedIn('Inicia sesión o crea una cuenta para guardar rutas comunitarias.')) return false;
    try {
        await DB.put(route);
        savedRoutes.unshift(route);
        renderSavedRoutes();
    } catch (error) {
        console.warn('No se pudo guardar la ruta comunitaria:', error);
        toast('No se pudo guardar la ruta en este dispositivo.');
        return;
    }
    let unavailablePhotos = 0, downloadedPhotos = 0;
    for (const poi of route.pois) {
        let timer = null;
        try {
            const controller = new AbortController();
            timer = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(poi.photoUrl, { signal: controller.signal });
            if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
            poi.photo = await response.blob();
            delete poi.photoUrl;
            downloadedPhotos++;
            clearTimeout(timer);
        } catch (error) {
            clearTimeout(timer);
            unavailablePhotos++;
            console.warn('No se pudo guardar una foto de la ruta para uso sin conexión:', error);
        }
    }
    if (downloadedPhotos) {
        try {
            await DB.put(route);
        } catch (error) {
            console.warn('No se pudieron guardar las fotos descargadas de la ruta:', error);
            unavailablePhotos += downloadedPhotos;
        }
        renderSavedRoutes();
    }
    toast(unavailablePhotos
        ? `Ruta guardada sin conexi\u00f3n. ${unavailablePhotos} foto(s) necesitar\u00e1n internet para mostrarse.`
        : 'Ruta guardada para seguirla sin conexi\u00f3n.');
}

function communityPublicPoiData(route, formData) {
    const sourcePois = Array.isArray(route.pois) ? route.pois : [];
    const segments = communityRawSegments(route.points);
    const endpoints = segments.length
        ? [segments[0][0], segments[segments.length - 1][segments[segments.length - 1].length - 1]]
        : [];
    const pois = [];
    let skipped = 0;
    sourcePois.forEach(poi => {
        if (!routePoiCoordinatesValid(poi) || !(poi.photo instanceof Blob)
            || poi.photo.size > ROUTE_POI_MAX_FILE_BYTES || poi.photo.type !== 'image/jpeg'
            || endpoints.some(endpoint => communityDistance([poi.lat, poi.lng], endpoint) < COMMUNITY_TRIM_METERS)) {
            skipped++;
            return;
        }
        const photoIndex = pois.length;
        if (photoIndex >= ROUTE_POI_MAX_PHOTOS) { skipped++; return; }
        formData.append('poiPhotos', poi.photo, `poi-${photoIndex + 1}.jpg`);
        pois.push({
            lat: poi.lat,
            lng: poi.lng,
            caption: String(poi.caption || 'Foto de ruta').slice(0, 100),
            photoIndex
        });
    });
    return { json: JSON.stringify(pois), count: pois.length, skipped };
}

async function deleteCommunityRoute(record) {
    if (!Cloud.loggedIn() || record.owner !== Cloud.uid) {
        toast('Solo quien publicó esta ruta puede eliminarla.');
        return;
    }
    const ok = await modal({
        message: `¿Eliminar «${record.title || 'Ruta de la comunidad'}» de la comunidad? Las copias guardadas en dispositivos no se borrarán.`,
        ok: 'Eliminar'
    });
    if (!ok) return;
    try {
        await cloudApi(`/api/collections/community_routes/records/${encodeURIComponent(record.id)}`, 'DELETE');
        const layer = communityVisibleLayers.get(record.id);
        if (layer && map) map.removeLayer(layer);
        communityVisibleLayers.delete(record.id);
        communityCatalogRoutes = communityCatalogRoutes.filter(route => route.id !== record.id);
        renderCommunityRoutes(communityCatalogRoutes);
        await refreshCommunityPublishedCount();
        communitySetStatus('Ruta eliminada de la comunidad.');
        toast('Ruta eliminada de la comunidad.');
    } catch (error) {
        console.warn('No se pudo eliminar la ruta comunitaria:', error);
        communitySetStatus(error.status === 403
            ? 'Solo quien publicó esta ruta puede eliminarla.'
            : 'No se pudo eliminar la ruta: ' + (error.message || 'error de conexión'), true);
    }
}

function communityPopup(record, lines) {
    const box = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = record.title || 'Ruta de la comunidad';
    const info = document.createElement('p');
    const elevationGain = Number(record.elevationGain);
    const elevationLabel = elevationGain > 0
        ? `+${Math.round(elevationGain)} m`
        : 'desnivel no disponible';
    info.textContent = communityAutonomousCommunity(record.province) + ' · ' +
        ((Number(record.distanceKm) || 0).toFixed(1)) + ' km · ' + elevationLabel;
    const follow = document.createElement('button');
    follow.type = 'button';
    follow.textContent = 'Seguir ruta';
    follow.className = 'btn';
    follow.addEventListener('click', () => {
        if (requireSignedIn('Inicia sesión o crea una cuenta para ver rutas comunitarias.')) {
            followRoute(communityLocalRoute(record, lines));
        }
    });
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Guardar sin conexión';
    save.className = 'btn secondary';
    save.addEventListener('click', () => saveCommunityOffline(record, lines));
    box.append(title, info, follow, save);
    return box;
}

function toggleCommunityRoute(record, lines, button) {
    if (!requireSignedIn('Inicia sesión o crea una cuenta para ver rutas comunitarias.')) return;
    if (!map) return;
    const oldLayer = communityVisibleLayers.get(record.id);
    if (oldLayer) {
        map.removeLayer(oldLayer);
        communityVisibleLayers.delete(record.id);
        button.textContent = 'Mostrar en mapa';
        return;
    }
    const layer = L.polyline(lines, { color: '#e040fb', weight: 5, opacity: 0.85 });
    layer.on('click', event => {
        L.popup().setLatLng(event.latlng).setContent(communityPopup(record, lines)).openOn(map);
    });
    layer.addTo(map);
    communityVisibleLayers.set(record.id, layer);
    button.textContent = 'Quitar del mapa';
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
    goToPage(0);
    closeCommunityDialog();
}

function renderCommunityRoutes(records) {
    const list = $('community-route-list');
    list.replaceChildren();
    if (!records.length) {
        const empty = document.createElement('p');
        empty.className = 'community-empty';
        empty.textContent = 'No hay rutas publicadas con estos filtros.';
        list.append(empty);
        updateCommunityRoutesCount();
        return;
    }
    const sortedRecords = records.slice().sort((a, b) => {
        const aDistance = Number(a.proximityKm), bDistance = Number(b.proximityKm);
        const aHasDistance = a.proximityKm != null && Number.isFinite(aDistance);
        const bHasDistance = b.proximityKm != null && Number.isFinite(bDistance);
        if (aHasDistance && bHasDistance) return aDistance - bDistance;
        if (aHasDistance) return -1;
        if (bHasDistance) return 1;
        return 0;
    });
    sortedRecords.forEach(record => {
        const lines = communityRecordLines(record);
        if (!lines) return;
        const card = document.createElement('article');
        card.className = 'community-route-card';
        const heading = document.createElement('button');
        heading.type = 'button';
        heading.className = 'community-route-title';
        heading.textContent = record.title || 'Ruta de la comunidad';
        heading.addEventListener('click', () => openCommunityDetail(record, lines));
        const facts = document.createElement('p');
        const poiCount = communityPoisFromRecord(record).length;
        const difficulty = COMMUNITY_DIFFICULTIES[record.difficulty];
        facts.textContent = (record.createdBy ? `Por ${record.createdBy} · ` : '') +
            (record.proximityKm != null ? `A ${record.proximityKm.toFixed(1)} km · ` : '') +
            [record.locality, communityAutonomousCommunity(record.province)].filter(Boolean).join(', ') + ' · ' +
            ((Number(record.distanceKm) || 0).toFixed(1)) + ' km · ' +
            (Number(record.elevationGain) > 0 ? `+${Math.round(Number(record.elevationGain))} m` : 'desnivel no disponible') +
            (difficulty ? ` · ${difficulty}` : '') +
            (poiCount ? ` · 📷 ${poiCount} POI` : '');
        const actions = document.createElement('div');
        actions.className = 'community-route-actions';
        const show = document.createElement('button');
        show.type = 'button';
        show.className = 'btn secondary';
        show.textContent = communityVisibleLayers.has(record.id) ? 'Quitar del mapa' : 'Mostrar en mapa';
        show.addEventListener('click', () => toggleCommunityRoute(record, lines, show));
        const follow = document.createElement('button');
        follow.type = 'button';
        follow.className = 'btn';
        follow.textContent = 'Seguir';
        follow.addEventListener('click', () => {
            if (!requireSignedIn('Inicia sesión o crea una cuenta para ver rutas comunitarias.')) return;
            followRoute(communityLocalRoute(record, lines));
            closeCommunityDialog();
        });
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'btn secondary';
        save.textContent = 'Guardar';
        save.addEventListener('click', () => saveCommunityOffline(record, lines));
        const gpx = document.createElement('button');
        gpx.type = 'button';
        gpx.className = 'btn secondary';
        gpx.textContent = 'Descargar GPX';
        gpx.addEventListener('click', () => {
            if (!requireSignedIn('Inicia sesión o crea una cuenta para descargar rutas comunitarias.')) return;
            const route = communityLocalRoute(record, lines);
            const filename = String(record.title || 'ruta-comunitaria')
                .replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_').trim() || 'ruta-comunitaria';
            download(`${filename}.gpx`, routeToGpx(route), 'application/gpx+xml');
        });
        actions.append(show, follow, save, gpx);
        if (Cloud.loggedIn() && record.owner === Cloud.uid) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn secondary';
            remove.textContent = 'Eliminar';
            remove.addEventListener('click', () => deleteCommunityRoute(record));
            actions.append(remove);
        }
        card.append(heading, facts, actions);
        list.append(card);
    });
    updateCommunityRoutesCount();
}

function escapeCommunityFilterValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function readCommunitySearchCache(
    activity, radiusKm, searchPosition, community, author, difficulty, minAscent, server
) {
    try {
        const cache = await DB.kvGet(COMMUNITY_SEARCH_CACHE_KEY);
        if (!cache || cache.server !== server || cache.activity !== activity || cache.radiusKm !== radiusKm
            || (cache.community || '') !== community
            || (cache.author || '') !== author
            || cache.difficulty !== difficulty || cache.minAscent !== minAscent
            || Date.now() - cache.savedAt > COMMUNITY_SEARCH_CACHE_MAX_AGE_MS
            || !Array.isArray(cache.routes)) return null;
        if (searchPosition && (!Array.isArray(cache.position) || communityDistanceToBounds(searchPosition, {
            minLat: cache.position[0], maxLat: cache.position[0],
            minLng: cache.position[1], maxLng: cache.position[1]
        }) > 5)) return null;
        if (!searchPosition) return { routes: cache.routes.slice(0, COMMUNITY_MAX_RESULTS), savedAt: cache.savedAt };
        const routes = cache.routes.map(route => {
            const lines = communityRecordLines(route);
            if (!lines) return null;
            const proximityKm = communityDistanceToRoute(searchPosition, lines) / 1000;
            return proximityKm <= radiusKm ? { ...route, proximityKm } : null;
        }).filter(Boolean).sort((a, b) => a.proximityKm - b.proximityKm).slice(0, COMMUNITY_MAX_RESULTS);
        return { routes, savedAt: cache.savedAt };
    } catch (error) {
        console.warn('No se pudo leer la búsqueda comunitaria guardada:', error);
        return null;
    }
}

async function communityFetchRouteMetadata(page, filter, includeBounds, isCurrentSearch) {
    const baseFields = ['id', 'owner', 'title', 'province', 'locality', 'difficulty', 'activityType',
        'distanceKm', 'elevationGain', 'movingTimeSec'];
    const fields = includeBounds ? [...baseFields, 'minLat', 'maxLat', 'minLng', 'maxLng'] : baseFields;
    const url = requestedFields => '/api/collections/community_routes/records?page=' + page +
        '&perPage=' + COMMUNITY_PAGE_SIZE + '&sort=-id&fields=' + requestedFields.join(',')
        + '&filter=' + encodeURIComponent(filter);
    try {
        return await cloudApi(url(['id', 'owner', 'createdBy', 'title', 'province', 'performedAt', 'locality', 'difficulty',
            'activityType', 'distanceKm', 'elevationGain', 'movingTimeSec',
            ...(includeBounds ? ['minLat', 'maxLat', 'minLng', 'maxLng'] : [])]));
    } catch (error) {
        if (error.status !== 400 || !isCurrentSearch()) throw error;
        return cloudApi(url(fields));
    }
}

async function loadCommunityRoutes() {
    if (!requireSignedIn('Inicia sesión o crea una cuenta para ver rutas comunitarias.')) {
        $('community-search').disabled = false;
        communityHandleAccountStateChange();
        return false;
    }
    const requestId = ++communitySearchRequest;
    const button = $('community-search');
    const server = Cloud.server;
    const uid = Cloud.uid;
    const authGeneration = Cloud.authGeneration;
    const isCurrentSearch = () => requestId === communitySearchRequest
        && Cloud.loggedIn()
        && Cloud.server === server
        && Cloud.uid === uid
        && Cloud.authGeneration === authGeneration;
    refreshCommunityPublishedCount();
    const searchPosition = lastLat === null || lastLon === null ? null : [lastLat, lastLon];
    const autonomousCommunity = $('community-autonomous-community-search').value;
    const authorInput = $('community-author-search').value.trim().slice(0, 32);
    const author = communityNicknameKey(authorInput);
    const difficulty = $('community-difficulty').value;
    const minAscent = Number($('community-ascent').value) || 0;
    if (!searchPosition && !autonomousCommunity && !author) {
        button.disabled = false;
        communitySearchActive = false;
        communityCatalogRoutes = [];
        renderCommunityRoutes(communityCatalogRoutes);
        communitySetStatus('Activa el GPS, elige una comunidad autónoma o busca por usuario para encontrar rutas.', true);
        if (typeof requestCurrentGpsFix === 'function') requestCurrentGpsFix();
        return false;
    }
    communitySearchActive = true;
    const activity = $('community-activity').value;
    const radiusKm = Number($('community-radius').value) || 25;
    const cached = await readCommunitySearchCache(
        activity, radiusKm, searchPosition, autonomousCommunity, author, difficulty, minAscent, server
    );
    if (!Cloud.loggedIn()) {
        if (requestId === communitySearchRequest) button.disabled = false;
        communityHandleAccountStateChange();
        return false;
    }
    if (!isCurrentSearch()) {
        if (requestId === communitySearchRequest) button.disabled = false;
        return false;
    }
    let displayedCache = false;
    if (cached) {
        communityCatalogRoutes = cached.routes;
        renderCommunityRoutes(communityCatalogRoutes);
        displayedCache = true;
    }
    if (!navigator.onLine) {
        communitySetStatus(cached
            ? `Mostrando ${cached.routes.length} rutas guardadas sin conexión (búsqueda del ${new Date(cached.savedAt).toLocaleDateString('es-ES')}).`
            : 'El catálogo necesita conexión. Las rutas guardadas sí están disponibles sin conexión.', !cached);
        if (!cached) {
            communityCatalogRoutes = [];
            renderCommunityRoutes(communityCatalogRoutes);
        }
        if (isCurrentSearch()) button.disabled = false;
        return false;
    }
    button.disabled = true;
    communitySetStatus(displayedCache ? 'Mostrando resultados guardados mientras se actualiza la búsqueda…' : 'Buscando rutas cercanas…');
    try {
        const filters = ['published = true'];
        if (searchPosition) {
            const latDelta = radiusKm / 110.574;
            const lonDelta = Math.min(180, radiusKm / (111.32 * Math.max(0.05, Math.cos(searchPosition[0] * Math.PI / 180))));
            const south = Math.max(-90, searchPosition[0] - latDelta);
            const north = Math.min(90, searchPosition[0] + latDelta);
            const west = Math.max(-180, searchPosition[1] - lonDelta);
            const east = Math.min(180, searchPosition[1] + lonDelta);
            filters.push(`minLat <= ${north.toFixed(6)}`, `maxLat >= ${south.toFixed(6)}`,
                `minLng <= ${east.toFixed(6)}`, `maxLng >= ${west.toFixed(6)}`);
        }
        if (activity) filters.push('activityType = "' + activity.replace(/"/g, '\\"') + '"');
        if (autonomousCommunity) filters.push(communityAutonomousCommunityFilter(autonomousCommunity));
        if (author) filters.push(`owner.nicknameKey ~ "${escapeCommunityFilterValue(author)}"`);
        if (difficulty) filters.push(`difficulty = "${difficulty}"`);
        if (minAscent) filters.push(`elevationGain >= ${minAscent}`);
        const filter = filters.join(' && ');
        const metadata = [];
        let page = 1, totalPages = 1;
        let metadataWithoutBounds = false;
        try {
            do {
                const result = await communityFetchRouteMetadata(page, filter, true, isCurrentSearch);
                if (!isCurrentSearch()) return false;
                if (Array.isArray(result.items)) {
                    metadata.push(...result.items.slice(0, COMMUNITY_MAX_METADATA_CANDIDATES - metadata.length));
                }
                totalPages = Number(result.totalPages) || 1;
                page++;
            } while (page <= totalPages && metadata.length < COMMUNITY_MAX_METADATA_CANDIDATES);
        } catch (error) {
            // Esquemas de PocketBase antiguos pueden no tener los campos de índice geográfico.
            // Reintenta sin esos campos; la distancia exacta se valida luego contra el GPX.
            if (error.status !== 400 || !searchPosition || !isCurrentSearch()) throw error;
            metadata.length = 0;
            page = 1;
            totalPages = 1;
            metadataWithoutBounds = true;
            const compatibleFilters = filters.filter(item => !/^(minLat|maxLat|minLng|maxLng)\s*[<>=]/.test(item));
            const compatibleFilter = compatibleFilters.join(' && ');
            do {
                const result = await communityFetchRouteMetadata(page, compatibleFilter, false, isCurrentSearch);
                if (!isCurrentSearch()) return false;
                if (Array.isArray(result.items)) {
                    metadata.push(...result.items.slice(0, COMMUNITY_MAX_METADATA_CANDIDATES - metadata.length));
                }
                totalPages = Number(result.totalPages) || 1;
                page++;
            } while (page <= totalPages && metadata.length < COMMUNITY_MAX_METADATA_CANDIDATES);
            console.warn('El catálogo no tiene índices geográficos; se comprobará el radio leyendo los trazados.');
        }

        // Incluye un conjunto acotado de rutas anteriores a los campos espaciales nuevos.
        const indexedIds = new Set(metadata.map(record => record.id));
        const legacyFilter = ['published = true'];
        if (searchPosition && !metadataWithoutBounds) {
            // Las rutas ya publicadas antes de instalar el hook pueden tener la caja a 0,0,0,0.
            // Trátalas como antiguas sin índice y decide por distancia leyendo su trazado.
            legacyFilter.push('(minLat = null || maxLat = null || minLng = null || maxLng = null || (minLat = 0 && maxLat = 0 && minLng = 0 && maxLng = 0))');
        }
        if (activity) legacyFilter.push('activityType = "' + activity.replace(/"/g, '\\"') + '"');
        if (autonomousCommunity) legacyFilter.push(communityAutonomousCommunityFilter(autonomousCommunity));
        if (author) legacyFilter.push(`owner.nicknameKey ~ "${escapeCommunityFilterValue(author)}"`);
        if (difficulty) legacyFilter.push(`difficulty = "${difficulty}"`);
        if (minAscent) legacyFilter.push(`elevationGain >= ${minAscent}`);
        const legacyResult = !searchPosition || metadataWithoutBounds
            ? { items: [], totalItems: 0 }
            : await cloudApi('/api/collections/community_routes/records?page=1&perPage=100&sort=-id&fields=id,owner,createdBy,title,province,locality,difficulty,activityType,distanceKm,elevationGain,movingTimeSec&filter=' + encodeURIComponent(legacyFilter.join(' && ')));
        if (!isCurrentSearch()) return false;
        const legacyRoutes = (legacyResult.items || []).filter(record => !indexedIds.has(record.id));
        const legacyTruncated = Number(legacyResult.totalItems) > legacyRoutes.length;

        const candidates = metadata.map(record => ({
            ...record,
            boundsDistanceKm: searchPosition ? communityDistanceToBounds(searchPosition, record) : 0,
            indexed: true
        })).filter(record => !searchPosition || record.boundsDistanceKm <= radiusKm)
            .concat(legacyRoutes.map(record => ({ ...record, boundsDistanceKm: 0, indexed: false })))
            .sort((a, b) => a.boundsDistanceKm - b.boundsDistanceKm);

        const nearbyRoutes = [];
        let checked = 0, tracksComplete = false;
        while (checked < candidates.length && checked < COMMUNITY_MAX_TRACKS_TO_CHECK) {
            const batch = candidates.slice(checked, Math.min(checked + COMMUNITY_TRACK_BATCH_SIZE, COMMUNITY_MAX_TRACKS_TO_CHECK));
            const results = await Promise.allSettled(batch.map(async record => {
                const detail = await cloudApi(`/api/collections/community_routes/records/${encodeURIComponent(record.id)}?fields=trackJson`);
                const fullRecord = { ...record, trackJson: detail.trackJson };
                const lines = communityRecordLines(fullRecord);
                if (!lines) return null;
                if (!searchPosition) return fullRecord;
                const proximityKm = communityDistanceToRoute(searchPosition, lines) / 1000;
                return proximityKm <= radiusKm ? { ...fullRecord, proximityKm } : null;
            }));
            if (!isCurrentSearch()) return false;
            checked += batch.length;
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value) nearbyRoutes.push(result.value);
                else if (result.status === 'rejected') console.warn('No se pudo cargar un trazado candidato:', result.reason);
            });
            nearbyRoutes.sort((a, b) => searchPosition
                ? a.proximityKm - b.proximityKm
                : String(a.title || '').localeCompare(String(b.title || ''), 'es'));
            const nextCandidate = candidates[checked];
            if (nearbyRoutes.length >= COMMUNITY_MAX_RESULTS
                && (!nextCandidate || nextCandidate.boundsDistanceKm > nearbyRoutes[COMMUNITY_MAX_RESULTS - 1].proximityKm)) {
                tracksComplete = true;
                break;
            }
        }
        if (checked >= candidates.length) tracksComplete = true;
        const metadataTruncated = metadata.length >= COMMUNITY_MAX_METADATA_CANDIDATES && page <= totalPages;
        const searchLimited = metadataTruncated || legacyTruncated || (!tracksComplete && checked < candidates.length);
        if (!Cloud.loggedIn()) {
            communityHandleAccountStateChange();
            return false;
        }
        if (!isCurrentSearch()) return false;
        communityCatalogRoutes = nearbyRoutes.slice(0, COMMUNITY_MAX_RESULTS);
        renderCommunityRoutes(communityCatalogRoutes);
        DB.kvSet(COMMUNITY_SEARCH_CACHE_KEY, {
            server, activity, radiusKm, position: searchPosition, community: autonomousCommunity,
            author, difficulty, minAscent, savedAt: Date.now(),
            routes: communityCatalogRoutes
        }).catch(error => console.warn('No se pudo guardar la búsqueda comunitaria:', error));
        const searchContext = [
            autonomousCommunity ? `en ${autonomousCommunity}` : '',
            author ? `por «${authorInput}»` : ''
        ].filter(Boolean).join(' y ');
        communitySetStatus(searchLimited
            ? `${communityCatalogRoutes.length} rutas encontradas en una búsqueda limitada a ${checked} trazados. Reduce los filtros para afinar los resultados.`
            : nearbyRoutes.length >= COMMUNITY_MAX_RESULTS
                ? searchPosition
                    ? `Mostrando las ${COMMUNITY_MAX_RESULTS} rutas más cercanas dentro de ${radiusKm} km${searchContext ? `, ${searchContext}` : ''}.`
                    : `Mostrando ${COMMUNITY_MAX_RESULTS} rutas${searchContext ? ` ${searchContext}` : ''}.`
                : nearbyRoutes.length
                ? searchPosition
                    ? `${nearbyRoutes.length} rutas cercanas${searchContext ? ` ${searchContext}` : ''}. Puedes abrir el detalle, mostrarlas en el mapa, seguirlas o guardarlas.`
                    : `${nearbyRoutes.length} rutas encontradas${searchContext ? ` ${searchContext}` : ''}.`
                : searchPosition
                    ? `No hay rutas publicadas dentro de ${radiusKm} km${searchContext ? ` ${searchContext}` : ''} con estos filtros.`
                    : `No hay rutas publicadas${searchContext ? ` ${searchContext}` : ''} con estos filtros.`);
        return true;
    } catch (error) {
        if (!Cloud.loggedIn()) {
            communityHandleAccountStateChange();
            return false;
        }
        if (!isCurrentSearch()) return false;
        console.warn('No se pudo cargar el catálogo comunitario:', error);
        communitySetStatus(error.status === 404
            ? 'El servidor aún no tiene la colección community_routes instalada.'
            : 'No se pudo cargar el catálogo: ' + (error.message || 'error de conexión'), true);
        if (!displayedCache) {
            communityCatalogRoutes = [];
            renderCommunityRoutes(communityCatalogRoutes);
        }
        return false;
    } finally {
        if (requestId === communitySearchRequest) button.disabled = false;
    }
}
function initCommunityRoutes() {
    communityFillActivities($('community-activity'));
    communityFillAutonomousCommunities($('community-share-autonomous-community'));
    communityFillAutonomousCommunities($('community-autonomous-community-search'), 'Todas las comunidades');
    $('community-close').addEventListener('click', closeCommunityDialog);
    $('community-dialog').addEventListener('click', communityHandleDetailTap, true);
    $('community-dialog').addEventListener('click', event => {
        if (event.target === $('community-dialog')) closeCommunityDialog();
    });
    $('community-search').addEventListener('click', loadCommunityRoutes);
    $('community-favorites-show').addEventListener('click', loadCommunityFavorites);
    $('community-submit').addEventListener('click', submitCommunityRoute);
    $('community-back').addEventListener('click', openCommunityCatalog);
    $('community-detail-back').addEventListener('click', () => communityDetailBackAction());
    $('community-detail-follow').addEventListener('click', () => {
        if (communityDetailFollowAction) communityDetailFollowAction();
    });
    $('community-segment-map-back').addEventListener('click', closeCommunityDialog);
    $('community-create-segment').addEventListener('click', communityBeginSegmentCreation);
    $('community-segment-cancel').addEventListener('click', communityCancelSegmentCreation);
    $('community-segment-submit').addEventListener('click', communitySubmitSegment);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !$('community-dialog').hidden) closeCommunityDialog();
    });
}

initCommunityRoutes();
