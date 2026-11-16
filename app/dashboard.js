'use strict';

const DASHBOARD_ORDER_KEY = 'mtb_pro_dashboard_card_order_v1';
let dashboardArrangeMode = false;

function dashboardOrderGroups() {
    return ['dashboard-kpis', 'dashboard-main-grid', 'dashboard-lower-grid']
        .map(id => $(id)).filter(Boolean);
}

function dashboardSaveCardOrder() {
    const order = Object.fromEntries(dashboardOrderGroups().map(group => [
        group.id,
        [...group.children].map(card => card.id).filter(Boolean)
    ]));
    try { localStorage.setItem(DASHBOARD_ORDER_KEY, JSON.stringify(order)); }
    catch (error) { console.warn('No se pudo guardar el orden del dashboard:', error); }
    if (typeof queueCloudPreferencesSync === 'function') queueCloudPreferencesSync();
}

function dashboardApplySavedCardOrder() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(DASHBOARD_ORDER_KEY) || '{}') || {}; }
    catch (error) { saved = {}; }
    dashboardOrderGroups().forEach(group => {
        const cards = [...group.children];
        const byId = new Map(cards.map(card => [card.id, card]));
        const order = [...(Array.isArray(saved[group.id]) ? saved[group.id] : []), ...cards.map(card => card.id)]
            .filter((id, index, list) => byId.has(id) && list.indexOf(id) === index);
        order.forEach(id => group.appendChild(byId.get(id)));
    });
}

function dashboardRefreshOrderControls() {
    dashboardOrderGroups().forEach(group => {
        const cards = [...group.children];
        cards.forEach((card, index) => {
            card.classList.toggle('dashboard-card-arranging', dashboardArrangeMode);
            let controls = card.querySelector('.dashboard-order-controls');
            if (!controls) {
                controls = document.createElement('span');
                controls.className = 'dashboard-order-controls';
                [['up', 'Subir tarjeta', '↑'], ['down', 'Bajar tarjeta', '↓']].forEach(([direction, label, icon]) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'dashboard-order-button';
                    button.dataset.dashboardMove = direction;
                    button.setAttribute('aria-label', label);
                    button.textContent = icon;
                    controls.appendChild(button);
                });
                const anchor = card.querySelector('.panel-heading') || card;
                anchor.appendChild(controls);
            }
            controls.hidden = !dashboardArrangeMode;
            const up = controls.querySelector('[data-dashboard-move="up"]');
            const down = controls.querySelector('[data-dashboard-move="down"]');
            if (up) up.disabled = index === 0;
            if (down) down.disabled = index === cards.length - 1;
        });
    });
    const toggle = $('dashboard-arrange-toggle');
    if (toggle) {
        toggle.setAttribute('aria-pressed', String(dashboardArrangeMode));
        toggle.querySelector('span').textContent = dashboardArrangeMode ? 'Listo' : 'Organizar';
    }
}

function dashboardInitCardArrangement() {
    dashboardApplySavedCardOrder();
    $('dashboard-arrange-toggle')?.addEventListener('click', () => {
        dashboardArrangeMode = !dashboardArrangeMode;
        dashboardRefreshOrderControls();
    });
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-dashboard-move]');
        if (!button || !dashboardArrangeMode) return;
        const card = button.closest('.dashboard-panel, .dashboard-kpi');
        const group = card?.parentElement;
        if (!card || !group) return;
        const sibling = button.dataset.dashboardMove === 'up' ? card.previousElementSibling : card.nextElementSibling;
        if (!sibling) return;
        group.insertBefore(card, button.dataset.dashboardMove === 'up' ? sibling : sibling.nextElementSibling);
        dashboardSaveCardOrder();
        dashboardRefreshOrderControls();
    });
    dashboardRefreshOrderControls();
}

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

function dashboardUpdateNetworkStatus() {
    const status = $('dashboard-network-status');
    if (!status) return;
    const online = navigator.onLine;
    status.classList.toggle('offline', !online);
    status.setAttribute('aria-label', online ? 'Conexión a internet disponible' : 'Sin conexión a internet');
    status.innerHTML = online ? '<i></i>En línea' : '<i></i>Sin conexión';
}

function dashboardLatestRecordedRoute() {
    return (Array.isArray(savedRoutes) ? savedRoutes : [])
        .filter(route => route && (route.kind === 'recorded' || !route.kind))
        .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0))[0] || null;
}

function dashboardRenderMapPreview(route) {
    const container = $('home-map');
    if (!container) return;
    const preview = route && typeof createRouteCardMap === 'function'
        ? createRouteCardMap(route)
        : null;
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

$('home-open-map')?.addEventListener('click', () => {
    const latest = dashboardLatestRecordedRoute();
    if (latest) openLastRideOnMap(latest);
    else goToPage(0);
});

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
dashboardInitCardArrangement();
dashboardUpdateNetworkStatus();
window.addEventListener('online', dashboardUpdateNetworkStatus);
window.addEventListener('offline', dashboardUpdateNetworkStatus);
