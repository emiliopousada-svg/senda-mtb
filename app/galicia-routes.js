'use strict';

// Catálogo estático servido desde pb_public/rutas/galicia para no incluir tracks en el APK.
const GALICIA_ROUTES_CATALOG_PATH = '/rutas/galicia/catalogo.json';
const GALICIA_ROUTES_CATALOG_CACHE_MS = 10 * 60 * 1000;
const GALICIA_ROUTE_BUNDLE_CACHE_LIMIT = 3;
let galiciaRoutesCatalogCache = null;
let galiciaRoutesCatalogLoadedAt = 0;
let galiciaRoutesCatalogRequest = null;
const galiciaRouteBundleCache = new Map();

function getGaliciaRoutesCatalogCount() {
    return Array.isArray(galiciaRoutesCatalogCache) ? galiciaRoutesCatalogCache.length : 0;
}

function galiciaRoutesStatus(message, isError = false) {
    const status = $('galicia-routes-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
}

function validGaliciaRouteEntry(route) {
    return route && typeof route === 'object'
        && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(String(route.id || ''))
        && typeof route.title === 'string' && route.title.trim().length > 0
        && typeof route.track === 'string'
        && /^tracks\/[a-z0-9][a-z0-9._-]{0,119}\.(?:gpx|kml)$/i.test(route.track)
        && typeof route.source === 'string' && /^https:\/\//i.test(route.source);
}

async function fetchGaliciaRoutesCatalog() {
    if (galiciaRoutesCatalogCache && Date.now() - galiciaRoutesCatalogLoadedAt < GALICIA_ROUTES_CATALOG_CACHE_MS) {
        return galiciaRoutesCatalogCache;
    }
    if (galiciaRoutesCatalogRequest) return galiciaRoutesCatalogRequest;
    galiciaRoutesCatalogRequest = (async () => {
        const response = await fetch(`${Cloud.server}${GALICIA_ROUTES_CATALOG_PATH}`, {
            headers: { Accept: 'application/json' },
            cache: 'no-cache'
        });
        if (!response.ok) {
            const error = new Error(response.status === 404
                ? 'El catálogo aún no está instalado en el servidor.'
                : `No se pudo cargar el catálogo (HTTP ${response.status}).`);
            error.status = response.status;
            throw error;
        }
        const payload = await response.json();
        if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.routes)) {
            throw new Error('El catálogo del servidor tiene un formato no válido.');
        }
        const routes = payload.routes.filter(validGaliciaRouteEntry);
        galiciaRoutesCatalogCache = routes;
        galiciaRoutesCatalogLoadedAt = Date.now();
        return routes;
    })().finally(() => { galiciaRoutesCatalogRequest = null; });
    return galiciaRoutesCatalogRequest;
}

function renderGaliciaRoutes(routes) {
    const list = $('galicia-routes-list');
    if (!list) return;
    list.replaceChildren();
    if (!routes.length) {
        const empty = document.createElement('p');
        empty.className = 'community-empty';
        empty.textContent = 'El catálogo oficial todavía no tiene tracks cargados.';
        list.append(empty);
        return;
    }
    routes.forEach(route => {
        const card = document.createElement('article');
        card.className = 'community-route-card';
        const title = document.createElement('h4');
        title.textContent = route.title;
        const facts = document.createElement('p');
        const distance = Number(route.distanceKm);
        const ascent = Number(route.elevationGain);
        facts.textContent = [route.locality, route.province || 'Galicia',
            Number.isFinite(distance) && distance > 0 ? `${distance.toFixed(1)} km` : '',
            Number.isFinite(ascent) && ascent > 0 ? `+${Math.round(ascent)} m` : ''].filter(Boolean).join(' · ');
        const attribution = document.createElement('p');
        attribution.textContent = `Fuente: ${route.attribution || 'Xunta de Galicia'} · ${route.license || 'Consulta las condiciones de la fuente'}`;
        const notice = document.createElement('p');
        notice.textContent = route.notice || 'Confirma el estado del camino y las restricciones antes de salir.';
        const actions = document.createElement('div');
        actions.className = 'community-route-actions';
        const detail = document.createElement('button');
        detail.type = 'button';
        detail.className = 'btn';
        detail.textContent = 'Ficha completa';
        detail.addEventListener('click', () => openGaliciaRouteDetail(route, detail));
        const show = document.createElement('button');
        show.type = 'button';
        show.className = 'btn secondary';
        show.textContent = 'Mostrar en mapa';
        show.addEventListener('click', () => showGaliciaRouteOnMap(route, show));
        const follow = document.createElement('button');
        follow.type = 'button';
        follow.className = 'btn secondary';
        follow.textContent = 'Seguir';
        follow.addEventListener('click', () => followGaliciaRoute(route, follow));
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'btn secondary';
        save.textContent = 'Guardar';
        save.addEventListener('click', () => downloadGaliciaRoute(route, save));
        const gpx = document.createElement('button');
        gpx.type = 'button';
        gpx.className = 'btn secondary';
        gpx.textContent = 'Descargar GPX';
        gpx.addEventListener('click', () => exportGaliciaRoute(route, gpx));
        const source = document.createElement('a');
        source.className = 'btn secondary';
        source.href = route.source;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = 'Ver fuente';
        actions.append(detail, show, follow, save, gpx, source);
        card.append(title, facts, attribution, notice, actions);
        list.append(card);
    });
}

async function loadGaliciaRouteBundle(route) {
    if (!Cloud.server || !validGaliciaRouteEntry(route)) throw new Error('La ruta del catálogo no es válida.');
    const cached = galiciaRouteBundleCache.get(route.id);
    if (cached) {
        galiciaRouteBundleCache.delete(route.id);
        galiciaRouteBundleCache.set(route.id, cached);
        return cached;
    }
    const request = (async () => {
        const root = `${Cloud.server}/rutas/galicia/`;
        const url = new URL(route.track, root);
        if (url.origin !== new URL(root).origin || !url.pathname.startsWith('/rutas/galicia/tracks/')) {
            throw new Error('La dirección del track no es válida.');
        }
        const response = await fetch(url.href, { headers: { Accept: 'application/gpx+xml, application/xml, text/xml' } });
        if (!response.ok) throw new Error(`No se pudo descargar el track (HTTP ${response.status}).`);
        const content = await response.text();
        if (content.length > 10 * 1024 * 1024) throw new Error('El track supera el límite de 10 MB.');
        const parsed = parseTrack(content, route.track);
        parsed.name = route.title;
        const imported = buildImportedRoute(parsed, `${routeActivityPrefix('mtb')}${route.title}`);
        imported.activityType = 'mtb';
        imported.kind = 'imported';
        imported.galiciaCatalogId = route.id;
        imported.source = route.source;
        imported.province = route.province || 'Galicia';
        imported.locality = route.locality || '';
        imported.description = route.notice || '';
        const lines = communityRawSegments(imported.points);
        if (!lines.length) throw new Error('El track no contiene un trazado que se pueda mostrar.');
        return { route: imported, lines };
    })();
    galiciaRouteBundleCache.set(route.id, request);
    try {
        const bundle = await request;
        galiciaRouteBundleCache.delete(route.id);
        galiciaRouteBundleCache.set(route.id, Promise.resolve(bundle));
        while (galiciaRouteBundleCache.size > GALICIA_ROUTE_BUNDLE_CACHE_LIMIT) {
            galiciaRouteBundleCache.delete(galiciaRouteBundleCache.keys().next().value);
        }
        return bundle;
    } catch (error) {
        galiciaRouteBundleCache.delete(route.id);
        throw error;
    }
}

async function withGaliciaRoute(route, button, callback) {
    if (button) button.disabled = true;
    try {
        const bundle = await loadGaliciaRouteBundle(route);
        return await callback(bundle);
    } catch (error) {
        console.warn('No se pudo cargar una ruta oficial de Galicia:', error);
        toast(error.message || 'No se pudo cargar la ruta.', 5000);
        return null;
    } finally {
        if (button) button.disabled = false;
    }
}

function galiciaDetailValues(route, imported) {
    return [
        ['Distancia', `${(Number(route.distanceKm) || Number(imported.distanceKm) || 0).toFixed(1)} km`],
        ['Desnivel', `+${Math.round(Number(route.elevationGain) || Number(imported.elevationGain) || 0)} m`],
        ['Actividad', 'Bicicleta de montaña'],
        ['Localidad', route.locality || 'No disponible'],
        ['Provincia', route.province || 'Galicia'],
        ['Fuente', route.attribution || 'Xunta de Galicia'],
        ['Licencia', route.license || 'Consulta las condiciones de la fuente']
    ];
}

async function openGaliciaRouteDetail(route, button) {
    return withGaliciaRoute(route, button, ({ route: imported, lines }) => {
        openCommunityDetail({ title: route.title, activityType: 'mtb', description: route.notice || '' }, lines, {
            backLabel: 'Volver a rutas oficiales',
            onBack: openCommunityCatalog,
            values: galiciaDetailValues(route, imported),
            onFollow: () => { closeCommunityDialog(); followRoute(imported); },
            actions: [
                ['Guardar', () => downloadGaliciaRoute(route)],
                ['Descargar GPX', () => download(`${String(route.title || 'ruta').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_')}.gpx`, routeToGpx(imported), 'application/gpx+xml')],
                ['Ver fuente', () => window.open(route.source, '_blank', 'noopener,noreferrer')]
            ]
        });
    });
}

async function showGaliciaRouteOnMap(route, button) {
    return withGaliciaRoute(route, button, ({ route: imported, lines }) => {
        if (!map) return;
        const key = `galicia:${route.id}`;
        const oldLayer = communityVisibleLayers.get(key);
        if (oldLayer) map.removeLayer(oldLayer);
        const layer = L.polyline(lines, { color: '#46d6a4', weight: 5, opacity: 0.9 });
        layer.addTo(map);
        communityVisibleLayers.set(key, layer);
        goToPage(0);
        const bounds = layer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
    });
}

async function followGaliciaRoute(route, button) {
    return withGaliciaRoute(route, button, ({ route: imported }) => followRoute(imported));
}

async function exportGaliciaRoute(route, button) {
    return withGaliciaRoute(route, button, ({ route: imported }) => {
        download(`${String(route.title || 'ruta').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_')}.gpx`, routeToGpx(imported), 'application/gpx+xml');
    });
}

async function downloadGaliciaRoute(route, button) {
    return withGaliciaRoute(route, button, async ({ route: imported }) => {
        if ((savedRoutes || []).some(saved => saved.galiciaCatalogId === route.id)) {
            toast(`«${route.title}» ya está guardada en este dispositivo.`);
            if (button) button.textContent = 'Guardada';
            return false;
        }
        const saved = await saveRoute(imported);
        if (saved) {
            toast(`«${route.title}» se ha descargado y guardado.`);
            if (button) button.textContent = 'Guardada';
        }
        return saved;
    });
}

async function loadGaliciaRouteCatalog() {
    const list = $('galicia-routes-list');
    if (!list || list.dataset.loaded === 'true') return;
    list.dataset.loaded = 'true';
    galiciaRoutesStatus('Cargando catálogo oficial de Galicia…');
    try {
        const routes = await fetchGaliciaRoutesCatalog();
        renderGaliciaRoutes(routes);
        updateCommunityRoutesCount();
        galiciaRoutesStatus(routes.length
            ? `${routes.length} rutas oficiales disponibles. Los tracks se descargan solo al guardarlos.`
            : 'El catálogo está instalado, pero todavía no contiene tracks.');
    } catch (error) {
        list.dataset.loaded = 'false';
        renderGaliciaRoutes([]);
        galiciaRoutesStatus(error.message || 'No se pudo conectar con el catálogo de Galicia.', true);
    }
}
