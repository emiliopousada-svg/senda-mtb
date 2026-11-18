'use strict';

// Catálogo estático servido desde pb_public/rutas/galicia para no incluir tracks en el APK.
const GALICIA_ROUTES_CATALOG_PATH = '/rutas/galicia/catalogo.json';
const GALICIA_ROUTES_CATALOG_CACHE_MS = 10 * 60 * 1000;
let galiciaRoutesCatalogCache = null;
let galiciaRoutesCatalogLoadedAt = 0;
let galiciaRoutesCatalogRequest = null;

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
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'btn';
        save.textContent = 'Descargar y guardar';
        save.addEventListener('click', () => downloadGaliciaRoute(route, save));
        const source = document.createElement('a');
        source.className = 'btn secondary';
        source.href = route.source;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = 'Ver fuente';
        actions.append(save, source);
        card.append(title, facts, attribution, notice, actions);
        list.append(card);
    });
}

async function downloadGaliciaRoute(route, button) {
    if (!Cloud.server || !validGaliciaRouteEntry(route)) {
        toast('La ruta del catálogo no es válida.');
        return;
    }
    button.disabled = true;
    try {
        const root = `${Cloud.server}/rutas/galicia/`;
        const url = new URL(route.track, root);
        if (url.origin !== new URL(root).origin || !url.pathname.startsWith('/rutas/galicia/tracks/')) {
            throw new Error('La dirección del track no es válida.');
        }
        const response = await fetch(url.href, { headers: { Accept: 'application/gpx+xml, application/xml, text/xml' } });
        if (!response.ok) throw new Error(`No se pudo descargar el track (HTTP ${response.status}).`);
        const gpx = await response.text();
        if (gpx.length > 10 * 1024 * 1024) throw new Error('El track supera el límite de 10 MB.');
        const parsed = parseTrack(gpx, route.track);
        parsed.name = route.title;
        const imported = buildImportedRoute(parsed, `${routeActivityPrefix('mtb')}${route.title}`);
        imported.activityType = 'mtb';
        imported.kind = 'imported';
        imported.galiciaCatalogId = route.id;
        imported.source = route.source;
        if (await saveRoute(imported)) {
            toast(`«${route.title}» se ha descargado y guardado.`);
            button.textContent = 'Guardada';
        }
    } catch (error) {
        console.warn('No se pudo importar una ruta oficial de Galicia:', error);
        toast(`No se pudo guardar la ruta: ${error.message || 'error de conexión'}`, 5000);
    } finally {
        button.disabled = false;
    }
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
