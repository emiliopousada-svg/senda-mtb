'use strict';

function dashboardUpdateGreeting() {
    const greeting = $('home-greeting');
    if (greeting) {
        // dashboard.js se carga antes que cloud.js: si Cloud aún no existe se lee el apodo guardado.
        // cloud.js vuelve a pintar el saludo al cargar y al cambiar la sesión.
        const stored = typeof Cloud !== 'undefined' ? Cloud.nickname : localStorage.getItem('mtb_pro_nickname');
        const nickname = String(stored || '').trim();
        greeting.textContent = `¡Hola, ${nickname || 'Biker'}!`;
    }

    const avatar = $('home-avatar');
    const avatarImage = $('home-avatar-image');
    const placeholder = $('home-avatar-placeholder');
    if (avatar && avatarImage && placeholder) {
        const avatarUrl = typeof getAccountAvatarUrl === 'function' ? getAccountAvatarUrl() : '';
        avatar.hidden = !avatarUrl;
        placeholder.hidden = Boolean(avatarUrl);
        if (avatarUrl) avatarImage.src = avatarUrl;
        else avatarImage.removeAttribute('src');
    }
    if (typeof profileRender === 'function') profileRender();
}

function dashboardInitAvatarViewer() {
    const trigger = $('home-avatar');
    const source = $('home-avatar-image');
    const dialog = $('home-avatar-dialog');
    const preview = $('home-avatar-dialog-image');
    const closeButton = $('home-avatar-dialog-close');
    if (!trigger || !source || !dialog || !preview || !closeButton) return;

    trigger.addEventListener('click', () => {
        if (trigger.hidden || !source.src || dialog.open) return;
        preview.src = source.src;
        dialog.showModal();
    });
    preview.addEventListener('click', () => dialog.close());
    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => preview.removeAttribute('src'));
}

function dashboardUpdateNav(page = currentPage) {
    const navPage = page === 6 ? 0 : page;
    document.querySelectorAll('.sidebar-link[data-page]').forEach(button => {
        const pageMatches = Number(button.dataset.page) === navPage;
        const slideMatches = button.dataset.statsSlide === undefined
            || Number(button.dataset.statsSlide) === activeStatsSlide;
        button.classList.toggle('active', pageMatches && slideMatches);
    });
    document.querySelectorAll('.mobile-nav .nav-btn[data-page]').forEach(button => {
        button.classList.toggle('active', Number(button.dataset.page) === navPage);
    });
}

function dashboardUpdateGpsStatus() {
    const status = $('dashboard-gps-status');
    const accuracy = Number(lastAccuracy);
    const quality = !firstFix || !Number.isFinite(accuracy) || accuracy < 0
        ? 0
        : accuracy <= 5 ? 4
            : accuracy <= 10 ? 3
                : accuracy <= 20 ? 2 : 1;
    const labels = ['Buscando', 'Débil', 'Aceptable', 'Buena', 'Excelente'];
    const mapStatus = $('map-live-gps');
    if (mapStatus) {
        mapStatus.setAttribute('data-gps-quality', String(quality));
        mapStatus.setAttribute('aria-label', `Calidad GPS: ${labels[quality]}`);
    }
    if (!status) return;
    const bars = Array.from({ length: 4 }, (_, index) =>
        `<i${index < quality ? ' class="active"' : ''}></i>`
    ).join('');
    status.classList.toggle('ready', quality > 0);
    status.setAttribute('data-gps-quality', String(quality));
    status.setAttribute('aria-label', `Calidad GPS: ${labels[quality]}${quality ? `, ${quality} de 4 barras` : ''}`);
    status.innerHTML = `<span class="gps-signal-bars" aria-hidden="true">${bars}</span><span>GPS<span class="gps-status-detail"> · ${labels[quality]}</span></span>`;
}

function dashboardUpdateNetworkStatus() {
    const status = $('dashboard-network-status');
    const online = navigator.onLine;
    if (status) {
        status.classList.toggle('connected', online);
        status.classList.toggle('offline', !online);
        status.setAttribute('aria-label', online ? 'Conexión a internet disponible' : 'Sin conexión a internet');
        status.innerHTML = online ? '<i></i><span>En línea</span>' : '<i></i><span>Sin conexión</span>';
    }

    if (typeof renderProfileManualSyncButton === 'function') renderProfileManualSyncButton();
}

function dashboardSetServerStatus(state, server) {
    if (server && typeof Cloud !== 'undefined') {
        try {
            if (Cloud.server !== server) return;
        } catch (error) {
            return;
        }
    }
    const indicator = $('acc-server-status');
    if (!indicator) return;
    const status = {
        checking: ['Comprobando…', 'Estado del servidor: comprobando'],
        connected: ['Conectado', 'Estado del servidor: conectado'],
        offline: ['Sin conexión', 'Estado del servidor: sin conexión']
    }[state];
    if (!status) return;

    if (state === 'connected') dashboardServerHealthCheckId++;
    indicator.classList.toggle('connected', state === 'connected');
    indicator.classList.toggle('offline', state === 'offline');
    indicator.setAttribute('aria-label', status[1]);
    indicator.title = status[1];
    const label = indicator.querySelector('span');
    if (label) label.textContent = status[0];
}

let dashboardServerHealthCheckId = 0;
let dashboardServerHealthPoll = null;
const DASHBOARD_SERVER_HEALTH_INTERVAL_MS = 30000;

async function dashboardCheckServerStatus() {
    if (typeof Cloud === 'undefined') return false;

    let server;
    try { server = Cloud.server; }
    catch (error) {
        dashboardSetServerStatus('offline');
        return false;
    }
    if (!server) {
        dashboardSetServerStatus('offline');
        return false;
    }

    const checkId = ++dashboardServerHealthCheckId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(`${server}/api/health`, {
            method: 'GET',
            signal: controller.signal,
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error'
        });
        if (checkId !== dashboardServerHealthCheckId || Cloud.server !== server) return false;
        dashboardSetServerStatus(response.ok ? 'connected' : 'offline', server);
        return response.ok;
    } catch (error) {
        if (checkId !== dashboardServerHealthCheckId) return false;
        try {
            if (Cloud.server !== server) return false;
        } catch (serverError) {
            // The configured server is invalid; show the same unavailable state.
        }
        dashboardSetServerStatus('offline');
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

function dashboardStartServerStatusUpdates() {
    if (dashboardServerHealthPoll !== null) return;
    dashboardSetServerStatus('checking');
    void dashboardCheckServerStatus();
    dashboardServerHealthPoll = setInterval(() => {
        if (document.visibilityState === 'visible') void dashboardCheckServerStatus();
    }, DASHBOARD_SERVER_HEALTH_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void dashboardCheckServerStatus();
    });
}

function dashboardLatestRecordedRoute() {
    return (Array.isArray(savedRoutes) ? savedRoutes : [])
        .filter(route => route && (route.kind === 'recorded' || !route.kind))
        .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0))[0] || null;
}

let dashboardTerrainMap = null;

function dashboardTerrainRouteSegments(route) {
    const points = Array.isArray(route && route.points) ? route.points : [];
    const segments = [];
    let segment = [];
    const finish = () => {
        if (segment.length > 1) segments.push(segment);
        segment = [];
    };
    const step = Math.max(1, Math.ceil(points.length / 1800));
    let segmentIndex = 0;
    points.forEach((point, index) => {
        if (!Array.isArray(point) || point[0] == null || point[1] == null
            || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))
            || Math.abs(Number(point[0])) > 90 || Math.abs(Number(point[1])) > 180) {
            finish();
            segmentIndex = 0;
            return;
        }
        if (point[5] === 1) {
            finish();
            segmentIndex = 0;
        }
        if (segmentIndex % step === 0 || index === points.length - 1) {
            segment.push([Number(point[1]), Number(point[0])]);
        }
        segmentIndex++;
    });
    finish();
    return segments;
}

function dashboardLastRidePreviewPath(route) {
    const segments = dashboardTerrainRouteSegments(route);
    const coordinates = segments.flat();
    if (coordinates.length < 2) return '';

    const centerLatitude = coordinates.reduce((sum, point) => sum + point[1], 0) / coordinates.length;
    const longitudeScale = Math.max(0.01, Math.cos(centerLatitude * Math.PI / 180));
    const projected = segments.map(segment =>
        segment.map(([longitude, latitude]) => [longitude * longitudeScale, latitude])
    );
    const allPoints = projected.flat();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < allPoints.length; i++) {
        const x = allPoints[i][0], y = allPoints[i][1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const scale = Math.min(60 / Math.max(rangeX, 0.000001), 56 / Math.max(rangeY, 0.000001));
    const offsetX = (76 - rangeX * scale) / 2;
    const offsetY = (72 - rangeY * scale) / 2;

    return projected.map(segment => segment.map(([x, y], index) =>
        `${index ? 'L' : 'M'}${(offsetX + (x - minX) * scale).toFixed(1)},${(72 - offsetY - (y - minY) * scale).toFixed(1)}`
    ).join(' ')).join(' ');
}

function dashboardCreateTerrainMap(route, container, routeKey) {
    if (!window.maplibregl || !navigator.onLine) return false;
    const segments = dashboardTerrainRouteSegments(route);
    if (!segments.length) return false;

    const coordinates = segments.flat();
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (let i = 0; i < coordinates.length; i++) {
        const lng = coordinates[i][0], lat = coordinates[i][1];
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }
    const middle = coordinates[Math.floor(coordinates.length / 2)];
    const mapElement = document.createElement('div');
    mapElement.className = 'dashboard-terrain-map';
    mapElement.setAttribute('role', 'img');
    mapElement.setAttribute('aria-label', `Vista satélite 3D de la ruta ${routeNameWithoutActivity(route) || 'reciente'}`);
    mapElement.routeReliefKey = routeKey;
    const routeFallback = typeof createRouteRelief3D === 'function'
        ? createRouteRelief3D(route)
        : null;
    container.replaceChildren(mapElement);
    if (routeFallback) container.appendChild(routeFallback);

    const style = {
        version: 8,
        sources: {
            satellite: {
                type: 'raster',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                maxzoom: 19,
                attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, Vantor, Earthstar Geographics, and the GIS User Community'
            },
            terrain: {
                type: 'raster-dem',
                tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
                tileSize: 512,
                encoding: 'terrarium',
                maxzoom: 17,
                attribution: '&copy; <a href="https://mapterhorn.com/attribution">Mapterhorn</a>'
            }
        },
        layers: [{ id: 'satellite-imagery', type: 'raster', source: 'satellite' }],
        terrain: { source: 'terrain', exaggeration: 1.35 }
    };

    let map;
    try {
        map = new window.maplibregl.Map({
            container: mapElement,
            style,
            center: middle,
            zoom: 13,
            pitch: 64,
            bearing: 0,
            maxPitch: 78,
            attributionControl: true,
            dragRotate: true,
            scrollZoom: false,
            doubleClickZoom: false,
            cooperativeGestures: true
        });
    } catch (error) {
        console.warn('[Última ruta] no se pudo iniciar el mapa 3D:', error);
        container.replaceChildren();
        return false;
    }
    dashboardTerrainMap = map;
    map.once('load', () => {
        if (dashboardTerrainMap !== map || !map.getContainer().isConnected) return;
        const routeGeometry = segments.length === 1
            ? { type: 'LineString', coordinates: segments[0] }
            : { type: 'MultiLineString', coordinates: segments };
        map.addSource('latest-route', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: routeGeometry }
        });
        map.addLayer({
            id: 'latest-route-outline', type: 'line', source: 'latest-route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#14202a', 'line-width': 8, 'line-opacity': 0.85 }
        });
        map.addLayer({
            id: 'latest-route-line', type: 'line', source: 'latest-route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#ffe84a', 'line-width': 4, 'line-opacity': 1 }
        });
        map.addSource('latest-route-points', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: segments[0][0] } },
                    { type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: segments[segments.length - 1].slice(-1)[0] } }
                ]
            }
        });
        map.addLayer({
            id: 'latest-route-markers', type: 'circle', source: 'latest-route-points',
            paint: {
                'circle-radius': 5,
                'circle-color': ['match', ['get', 'kind'], 'start', '#ffffff', '#ffe84a'],
                'circle-stroke-color': '#17202a',
                'circle-stroke-width': 2
            }
        });
        const lngPad = Math.max((maxLng - minLng) * 0.08, 0.00015);
        const latPad = Math.max((maxLat - minLat) * 0.08, 0.00015);
        map.fitBounds(
            new window.maplibregl.LngLatBounds([minLng - lngPad, minLat - latPad], [maxLng + lngPad, maxLat + latPad]),
            { padding: { top: 36, right: 32, bottom: 38, left: 32 }, maxZoom: 16.5, pitch: 64, duration: 0 }
        );
        map.resize();
        if (routeFallback) routeFallback.remove();
    });
    map.on('error', event => {
        if (event && event.error) console.warn('[Última ruta] error de mapa 3D:', event.error.message || event.error);
    });
    return true;
}

function dashboardRenderMapPreview(route) {
    const container = $('home-map');
    if (!container) return;
    container.dataset.routeAvailable = route ? 'true' : 'false';
    container.tabIndex = -1;
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', route
        ? `Vista satélite 3D de ${routeNameWithoutActivity(route) || 'la última ruta'}`
        : 'Vista satélite 3D de tu última ruta');
    const routeKey = route && typeof routeReliefKey === 'function'
        ? routeReliefKey(route)
        : route ? [route.id, route.points && route.points.length].join('|') : 'empty';
    const useTerrainMap = Boolean(route && navigator.onLine && window.maplibregl);
    const key = `${routeKey}|${useTerrainMap ? 'satellite-3d' : 'local-preview'}`;
    if (container.dataset.previewKey === key) return;
    container.dataset.previewKey = key;
    if (dashboardTerrainMap) {
        dashboardTerrainMap.remove();
        dashboardTerrainMap = null;
    }
    // Si la ruta no ha cambiado, se conserva el relieve (y el giro elegido por el usuario).
    const current = container.firstElementChild;
    if (route && current && current.routeReliefKey
        && current.routeReliefKey === routeKey && !useTerrainMap) return;
    if (useTerrainMap && dashboardCreateTerrainMap(route, container, routeKey)) return;
    // Muestra relieve 3D cuando hay altitud; si falta, mantiene el trazado en una vista isométrica.
    const relief = route && typeof createRouteRelief3D === 'function'
        ? createRouteRelief3D(route)
        : null;
    const preview = relief || (route && typeof createRouteCardMap === 'function'
        ? createRouteCardMap(route)
        : null);
    if (preview) {
        container.replaceChildren(preview);
        return;
    }

    const empty = document.createElement('div');
    empty.className = 'home-map-empty';
    const title = document.createElement('strong');
    title.textContent = route ? 'Recorrido no disponible' : 'Aún no hay recorridos';
    const message = document.createElement('span');
    message.textContent = route
        ? 'Esta salida no contiene un trazado que se pueda mostrar.'
        : 'Tu último recorrido aparecerá aquí cuando guardes una salida.';
    empty.append(title, message);
    container.replaceChildren(empty);
}

function dashboardLastRideAgo(startedAt) {
    const started = new Date(startedAt || 0);
    if (!startedAt || Number.isNaN(started.getTime())) return 'Última salida';
    const today = new Date();
    const dayStart = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.round((dayStart(today) - dayStart(started)) / 86400000);
    if (days <= 0) return 'Última salida hoy';
    if (days === 1) return 'Última salida ayer';
    if (days < 30) return `Última salida hace ${days} días`;
    return `Última salida el ${started.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`;
}

function dashboardUpdateLastRide(latest = dashboardLatestRecordedRoute()) {
    const line = $('home-last-ride');
    if (!line) return;
    if (!latest) {
        line.textContent = 'Tu primera salida aparecerá aquí.';
        return;
    }
    const distance = Number(latest.distanceKm);
    const ascent = Number(latest.elevationGain);
    const parts = [document.createTextNode(dashboardLastRideAgo(latest.startedAt))];
    if (Number.isFinite(distance) && distance > 0) {
        const strong = document.createElement('strong');
        strong.textContent = `${distance.toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
        parts.push(document.createTextNode(' · '), strong);
    }
    if (Number.isFinite(ascent) && ascent > 0) parts.push(document.createTextNode(` · +${Math.round(ascent)} m`));
    line.replaceChildren(...parts);
}

function dashboardRender() {
    dashboardUpdateGreeting();
    const latest = dashboardLatestRecordedRoute();
    dashboardUpdateLastRide(latest);
    const lastRoutePath = $('home-last-route-path');
    if (lastRoutePath) lastRoutePath.setAttribute('d', dashboardLastRidePreviewPath(latest));
    const routeCount = Array.isArray(savedRoutes) ? savedRoutes.length : 0;
    const count = $('home-routes-count');
    if (count) count.textContent = `${routeCount} ${routeCount === 1 ? 'ruta guardada' : 'rutas guardadas'}`;
    const latestName = $('home-last-route-name');
    const latestDate = $('home-last-route-date');
    const latestDistance = $('home-last-route-distance');
    const latestAscent = $('home-last-route-ascent');
    if (latest) {
        if (latestName) latestName.textContent = routeNameWithoutActivity(latest) || 'Ruta MTB';
        if (latestDate) latestDate.textContent = latest.startedAt
            ? new Date(latest.startedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'Salida guardada';
        if (latestDistance) latestDistance.textContent = `${Number(latest.distanceKm || 0).toFixed(1)} km`;
        if (latestAscent) latestAscent.textContent = Number.isFinite(Number(latest.elevationGain))
            ? `${Math.round(Number(latest.elevationGain))} m+`
            : '— m+';
    } else {
        if (latestName) latestName.textContent = 'Aún no hay salidas';
        if (latestDate) latestDate.textContent = 'Tu primera ruta te espera';
        if (latestDistance) latestDistance.textContent = '— km';
        if (latestAscent) latestAscent.textContent = '— m+';
    }
    const mapLabel = $('home-map-label');
    const openRouteButton = $('home-open-route');
    if (openRouteButton) openRouteButton.hidden = !latest;
    if (mapLabel) mapLabel.textContent = latest
        ? `Última ruta · ${routeNameWithoutActivity(latest) || 'MTB'}`
        : 'Sin recorridos realizados';
    dashboardRenderMapPreview(latest);
    const prompt = $('home-route-prompt');
    if (prompt) prompt.textContent = routeCount
        ? `${routeCount} rutas listas para consultar, seguir o exportar.`
        : 'Importa un GPX y prepara tu próxima salida de montaña.';
    dashboardUpdateGpsStatus();
    dashboardUpdateNetworkStatus();
}

function dashboardOpenLatestRouteDetail() {
    const latest = dashboardLatestRecordedRoute();
    if (latest) openSavedRouteDetail(latest, {
        backLabel: 'Volver a Inicio',
        onBack: () => closeCommunityDialog()
    });
}

$('home-open-route')?.addEventListener('click', dashboardOpenLatestRouteDetail);

const homeRoutePreview = $('home-map');
if (homeRoutePreview) {
    let previewPointerStart = null;
    let previewDragged = false;
    homeRoutePreview.addEventListener('pointerdown', event => {
        previewPointerStart = [event.clientX, event.clientY];
        previewDragged = false;
    }, { passive: true });
    homeRoutePreview.addEventListener('pointermove', event => {
        if (!previewPointerStart) return;
        if (Math.hypot(event.clientX - previewPointerStart[0], event.clientY - previewPointerStart[1]) > 8) {
            previewDragged = true;
        }
    }, { passive: true });
    homeRoutePreview.addEventListener('pointerup', () => {
        previewPointerStart = null;
        if (previewDragged) window.setTimeout(() => { previewDragged = false; }, 0);
    }, { passive: true });
    homeRoutePreview.addEventListener('click', event => {
        if (event.target.closest('.maplibregl-canvas, .maplibregl-control-container')) return;
        if (previewDragged || event.target.closest('button,a,input,select')) return;
        const latest = dashboardLatestRecordedRoute();
        if (latest) dashboardOpenLatestRouteDetail();
    });
    homeRoutePreview.addEventListener('keydown', event => {
        if ((event.key !== 'Enter' && event.key !== ' ') || event.target !== homeRoutePreview) return;
        event.preventDefault();
        const latest = dashboardLatestRecordedRoute();
        if (latest) dashboardOpenLatestRouteDetail();
    });
}

document.addEventListener('click', event => {
    const button = event.target.closest('[data-page]');
    if (!button) return;
    event.preventDefault();
    const page = Number(button.dataset.page);
    if (!Number.isInteger(page)) return;
    goToPage(page);
    if (button.dataset.statsSlide !== undefined) setStatsSlide(Number(button.dataset.statsSlide));
    if (page === 5) dashboardRender();
});

document.querySelectorAll('[data-recording]').forEach(button => {
    button.addEventListener('click', () => {
        goToPage(0);
        window.setTimeout(() => $('btn-start')?.click(), 80);
    });
});

dashboardInitAvatarViewer();
dashboardUpdateNav(currentPage);
dashboardUpdateGreeting();
dashboardUpdateNetworkStatus();
window.addEventListener('online', () => {
    dashboardUpdateNetworkStatus();
    void dashboardCheckServerStatus();
    dashboardRenderMapPreview(dashboardLatestRecordedRoute());
});
window.addEventListener('offline', () => {
    dashboardUpdateNetworkStatus();
    void dashboardCheckServerStatus();
    dashboardRenderMapPreview(dashboardLatestRecordedRoute());
});
