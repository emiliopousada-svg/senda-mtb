'use strict';

let dashboardMap = null;
let dashboardRouteLine = null;

function dashboardUpdateNav(page = currentPage) {
    document.querySelectorAll('.sidebar-link[data-page]').forEach(button => {
        const pageMatches = Number(button.dataset.page) === page;
        const slideMatches = button.dataset.statsSlide === undefined
            || Number(button.dataset.statsSlide) === activeStatsSlide;
        button.classList.toggle('active', pageMatches && slideMatches);
    });
    document.querySelectorAll('.mobile-nav .nav-btn[data-page]').forEach(button => {
        button.classList.toggle('active', Number(button.dataset.page) === page);
    });
}

function dashboardInitMap() {
    const container = $('home-map');
    if (!container || typeof L === 'undefined' || dashboardMap) return;
    dashboardMap = L.map(container, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: true,
        minZoom: 5,
        maxZoom: 18
    }).setView([13.4125, 103.867], 12);
    L.control.attribution({ prefix: false }).addTo(dashboardMap);
    try {
        createMapStyleLayer('satellite').addTo(dashboardMap);
    } catch (error) {
        console.warn('No se pudo cargar el mapa de inicio:', error);
    }
    dashboardRouteLine = L.polyline([], { color: '#168cff', weight: 4, opacity: .95, lineCap: 'round' }).addTo(dashboardMap);
    dashboardMap.whenReady(() => dashboardMap.invalidateSize({ pan: false }));
}

function dashboardUpdateGpsStatus() {
    const status = $('dashboard-gps-status');
    if (!status) return;
    const accuracy = Number(lastAccuracy);
    const ready = firstFix && Number.isFinite(accuracy) && accuracy <= MAX_ACC_M;
    status.classList.toggle('ready', ready);
    status.innerHTML = ready
        ? `<i></i>GPS · ${accuracy <= 10 ? 'Excelente' : 'Estable'}`
        : '<i></i>GPS · Buscando';
}

function dashboardRender() {
    const recorded = (Array.isArray(savedRoutes) ? savedRoutes : [])
        .filter(route => route && route.kind !== 'imported')
        .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
    const latest = recorded[0] || null;
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
    }
    const mapLabel = $('home-map-label');
    if (mapLabel) mapLabel.textContent = latest ? `Última ruta · ${routeNameWithoutActivity(latest) || 'MTB'}` : 'Angkor · Camboya';
    const prompt = $('home-route-prompt');
    if (prompt) prompt.textContent = routeCount
        ? `${routeCount} rutas listas para consultar, seguir o exportar.`
        : 'Importa un GPX y prepara tu próxima salida de montaña.';
    if (dashboardMap && dashboardRouteLine) {
        const coordinates = latest && Array.isArray(latest.points)
            ? latest.points.filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])).map(point => [point[0], point[1]])
            : [];
        dashboardRouteLine.setLatLngs(coordinates);
        if (coordinates.length > 1) dashboardMap.fitBounds(dashboardRouteLine.getBounds(), { padding: [24, 24], maxZoom: 14 });
    }
    dashboardUpdateGpsStatus();
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

dashboardUpdateNav(currentPage);

window.addEventListener('resize', () => {
    if (dashboardMap && currentPage === 5) requestAnimationFrame(() => dashboardMap.invalidateSize({ pan: false }));
}, { passive: true });
