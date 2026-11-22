'use strict';

//  INICIO
// ============================================================
// ============================================================
//  VISTA AMPLIADA DE MÉTRICAS (toca una métrica para verla grande)
// ============================================================
const METRICS = {
    speed: { src: 'm-speed',     label: 'Velocidad',          unit: 'km/h' },
    dist:  { src: 'm-dist',      label: 'Distancia',          unit: 'km' },
    elev:  { src: 'm-elevation', label: 'Desnivel positivo',  unit: 'm' },
    hr:    { src: 'm-hr',        label: 'Pulso',              unit: 'bpm', color: '#ef5350' },
    cadence: { src: 'm-cadence', label: 'Cadencia', unit: 'rpm', color: '#48c7a0' },
    power: { src: 'm-power', label: 'Potencia', unit: 'W', color: '#e8c34a' },
    'avg-speed': { src: 'm-avg-speed', label: 'Velocidad media', unit: 'km/h', color: '#55baff' },
    moving: { src: 'm-moving',   label: 'Tiempo en movimiento', unit: '' },
    'map-total-time': { src: 'm-time', label: 'Tiempo total', unit: '' },
    'map-altitude': { src: 'map-panel-altitude', label: 'Altitud', unit: 'm' },
    'map-distance': { src: 'm-dist', label: 'Distancia', unit: 'km' },
    'map-cadence': { src: 'm-cadence', label: 'Cadencia', unit: 'rpm', color: '#48c7a0' },
    'map-heart-rate': { src: 'm-hr', label: 'Pulso', unit: 'ppm', color: '#ef5350' }
};
let expandedMetric = null;
let mapPanelCollapseTimer = null;
let mapSideControlsCollapseTimer = null;
const MAP_ACTIVE_OVERLAY_TIMEOUT = 20_000;

function mapPanelSetExpanded(expanded) {
    const page = $('page-map');
    const panel = $('map-bottom-panel');
    const content = $('map-bottom-panel-content');
    const toggle = $('map-panel-toggle');
    if (!page || !panel || !content || !toggle) return;
    if (mapPanelCollapseTimer) clearTimeout(mapPanelCollapseTimer);
    mapPanelCollapseTimer = null;
    page.classList.toggle('panel-collapsed', !expanded);
    content.inert = !expanded;
    content.setAttribute('aria-hidden', String(!expanded));
    mapPanelSyncRouteProfile();
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Plegar panel de actividad' : 'Desplegar panel de actividad');
    toggle.innerHTML = `<span aria-hidden="true">${expanded ? '&#8964;' : '&#8963;'}</span>`;
    if (expanded && (isRecording || followedRoute)) mapPanelScheduleAutoCollapse(MAP_ACTIVE_OVERLAY_TIMEOUT);
}

function mapPanelSyncRouteProfile() {
    const page = $('page-map');
    const profile = $('map-route-profile');
    const liveProfile = $('recording-live-profile');
    if (!page || !profile) return;
    page.classList.toggle('panel-profile-visible', profile.classList.contains('show') || Boolean(liveProfile && !liveProfile.hidden));
}

function mapPanelScheduleAutoCollapse(delayMs = 1800) {
    if (mapPanelCollapseTimer) clearTimeout(mapPanelCollapseTimer);
    mapPanelCollapseTimer = setTimeout(() => mapPanelSetExpanded(false), delayMs);
}

function mapSideControlsSetVisible(visible) {
    const page = $('page-map');
    if (!page) return;
    const sideControls = page.querySelector('.side-controls');
    const zoomControls = page.querySelector('.map-zoom-controls');
    if (!sideControls || !zoomControls) return;
    if (mapSideControlsCollapseTimer) clearTimeout(mapSideControlsCollapseTimer);
    mapSideControlsCollapseTimer = null;
    page.classList.toggle('side-controls-collapsed', !visible);
    [sideControls, zoomControls].forEach(group => {
        group.inert = !visible;
        group.setAttribute('aria-hidden', String(!visible));
    });
    if (visible && (isRecording || followedRoute)) mapSideControlsScheduleAutoCollapse(MAP_ACTIVE_OVERLAY_TIMEOUT);
}

function mapSideControlsScheduleAutoCollapse(delayMs = 1800) {
    if (mapSideControlsCollapseTimer) clearTimeout(mapSideControlsCollapseTimer);
    mapSideControlsCollapseTimer = setTimeout(() => mapSideControlsSetVisible(false), delayMs);
}

function mapPanelSyncActions() {
    const follow = $('btn-follow-route');
    const stop = $('btn-stop');
    const actions = document.querySelector('.map-recording-actions');
    const canceling = Boolean(followedRoute);
    if (follow) {
        follow.hidden = false;
        follow.classList.toggle('is-cancel', canceling);
        follow.setAttribute('aria-label', canceling ? 'Cancelar seguimiento de ruta' : 'Seguir una ruta');
        $('btn-follow-route-label').textContent = canceling ? 'Cancelar seguimiento' : 'Seguir ruta';
        $('btn-follow-route-icon').textContent = canceling ? '×' : '↗';
    }
    if (stop) stop.hidden = !isRecording;
    if (actions) actions.classList.toggle('is-recording', Boolean(isRecording));
}

function updateGauge(v) {
    const LEN = 282.74;
    const max = Math.max(50, Math.ceil(v / 10) * 10); // la escala crece si pasas de 50 km/h
    $('gauge-arc').style.strokeDashoffset = LEN * (1 - Math.min(v / max, 1));
    $('gauge-max').textContent = max;
}

function syncBigMetric() {
    if (!expandedMetric) return;
    const txt = $(METRICS[expandedMetric].src).textContent;
    const big = $('big-value');
    big.textContent = txt;
    big.classList.toggle('long', txt.length > 5);
    if (expandedMetric === 'speed') updateGauge(parseFloat(txt) || 0);
}

function collapseMetric() {
    expandedMetric = null;
    $('big-metric').classList.remove('show');
    $('page-map').classList.remove('metric-open');
    document.querySelectorAll('.m-box').forEach(b => b.classList.remove('active'));
}

function expandMetric(key) {
    const m = METRICS[key];
    expandedMetric = key;
    $('big-label').textContent = m.label;
    $('big-unit').textContent = m.unit;
    $('big-value').style.color = m.color || '#fff';
    $('big-gauge').classList.toggle('show', key === 'speed');
    document.querySelectorAll('.m-box').forEach(b => b.classList.toggle('active', b.dataset.metric === key));
    $('big-metric').classList.add('show');
    $('page-map').classList.add('metric-open');
    syncBigMetric();
}

function initMetricPanel() {
    const activateMetric = e => {
        const box = e.target.closest('.m-box, .map-live-metric[data-metric]');
        if (!box) return;
        const key = box.dataset.metric;
        if (expandedMetric === key) collapseMetric(); // segundo toque: vuelve
        else expandMetric(key);
    };
    document.querySelector('.metrics-bar').addEventListener('click', activateMetric);
    const bannerMetrics = document.querySelector('.map-live-metrics');
    bannerMetrics.addEventListener('click', activateMetric);
    bannerMetrics.addEventListener('keydown', e => {
        if (!e.target.closest('.map-live-metric[data-metric]') || !['Enter', ' '].includes(e.key)) return;
        e.preventDefault();
        activateMetric(e);
    });
    $('big-metric').addEventListener('click', collapseMetric);
    $('map-panel-toggle').addEventListener('click', () => {
        mapPanelSetExpanded($('page-map').classList.contains('panel-collapsed'));
    });
    const mapPage = $('page-map');
    mapPage.addEventListener('click', () => {
        if (mapPage.classList.contains('side-controls-collapsed')) mapSideControlsSetVisible(true);
    });
    $('btn-follow-route').addEventListener('click', () => {
        if (followedRoute) {
            unfollowRoute();
            toast('Has dejado de seguir la ruta.');
            return;
        }
        goToPage(3);
        toast('Elige la ruta que quieres seguir.');
    });
    mapPanelSyncActions();
    mapSideControlsSetVisible(true);

    // El panel inferior (métricas + botones) cambia de alto según las métricas y los botones visibles:
    // se publica como --map-panel-h para que la atribución del mapa y los controles no queden debajo.
    const panel = $('map-bottom-panel');
    if (panel && typeof ResizeObserver === 'function') {
        const page = $('page-map');
        const routeProfile = $('map-route-profile');
        const liveProfile = $('recording-live-profile');
        const observer = new ResizeObserver(() => {
            page.style.setProperty('--map-panel-h', `${Math.ceil(panel.getBoundingClientRect().height)}px`);
            // Alto real del perfil de la ruta seguida, para apilar encima el perfil en directo.
            const profileH = routeProfile ? Math.ceil(routeProfile.getBoundingClientRect().height) : 0;
            if (profileH > 0) page.style.setProperty('--map-route-profile-h', `${profileH}px`);
            // Alto de todo lo apilado abajo (panel + perfiles visibles), para colocar la atribución encima.
            const pageBottom = page.getBoundingClientRect().bottom;
            const stackTop = [panel, routeProfile, liveProfile]
                .filter(el => el && el.offsetParent !== null && !(el === panel && page.classList.contains('panel-collapsed')))
                .reduce((top, el) => Math.min(top, el.getBoundingClientRect().top), pageBottom);
            page.style.setProperty('--map-stack-h', `${Math.ceil(pageBottom - stackTop)}px`);
        });
        [panel, routeProfile, liveProfile].forEach(el => el && observer.observe(el));
    }

    // La vista grande copia en vivo el valor de la métrica original
    const obs = new MutationObserver(syncBigMetric);
    Object.values(METRICS).forEach(m =>
        obs.observe($(m.src), { childList: true, characterData: true, subtree: true }));
}

// ============================================================
