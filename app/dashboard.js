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
    const placeholder = $('home-avatar-placeholder');
    if (avatar && placeholder) {
        const avatarUrl = typeof getAccountAvatarUrl === 'function' ? getAccountAvatarUrl() : '';
        avatar.hidden = !avatarUrl;
        placeholder.hidden = Boolean(avatarUrl);
        if (avatarUrl) avatar.src = avatarUrl;
        else avatar.removeAttribute('src');
    }
    if (typeof profileRender === 'function') profileRender();
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
    if (!status) return;
    const accuracy = Number(lastAccuracy);
    const quality = !firstFix || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACC_M
        ? 0
        : accuracy <= 5 ? 4
            : accuracy <= 10 ? 3
                : accuracy <= 20 ? 2 : 1;
    const labels = ['Buscando', 'Débil', 'Aceptable', 'Buena', 'Excelente'];
    const bars = Array.from({ length: 4 }, (_, index) =>
        `<i${index < quality ? ' class="active"' : ''}></i>`
    ).join('');
    status.classList.toggle('ready', quality > 0);
    status.setAttribute('data-gps-quality', String(quality));
    status.setAttribute('aria-label', `Calidad GPS: ${labels[quality]}${quality ? `, ${quality} de 4 barras` : ''}`);
    status.innerHTML = `<span class="gps-signal-bars" aria-hidden="true">${bars}</span><span>GPS · ${labels[quality]}</span>`;
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

    const accountIndicator = $('acc-server-status');
    if (accountIndicator) {
        accountIndicator.classList.toggle('connected', online);
        accountIndicator.classList.toggle('offline', !online);
        accountIndicator.setAttribute('aria-label', online ? 'Estado del servidor: conectado' : 'Estado del servidor: sin conexión');
    }
}

function dashboardLatestRecordedRoute() {
    return (Array.isArray(savedRoutes) ? savedRoutes : [])
        .filter(route => route && (route.kind === 'recorded' || !route.kind))
        .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0))[0] || null;
}

function dashboardRenderMapPreview(route) {
    const container = $('home-map');
    if (!container) return;
    container.dataset.routeAvailable = route ? 'true' : 'false';
    container.tabIndex = route ? 0 : -1;
    container.setAttribute('role', route ? 'button' : 'region');
    container.setAttribute('aria-label', route
        ? `Abrir ficha completa de ${routeNameWithoutActivity(route) || 'la última ruta'}, relieve 3D interactivo`
        : 'Relieve 3D de tu última ruta');
    // Si la ruta no ha cambiado, se conserva el relieve (y el giro elegido por el usuario).
    const current = container.firstElementChild;
    if (route && current && current.routeReliefKey
        && typeof routeReliefKey === 'function' && current.routeReliefKey === routeReliefKey(route)) return;
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

function dashboardRender() {
    dashboardUpdateGreeting();
    const latest = dashboardLatestRecordedRoute();
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

dashboardUpdateNav(currentPage);
dashboardUpdateGreeting();
dashboardUpdateNetworkStatus();
window.addEventListener('online', dashboardUpdateNetworkStatus);
window.addEventListener('offline', dashboardUpdateNetworkStatus);
