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
    moving: { src: 'm-moving',   label: 'Tiempo en movimiento', unit: '' }
};
let expandedMetric = null;

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
    document.querySelector('.metrics-bar').addEventListener('click', e => {
        const box = e.target.closest('.m-box');
        if (!box) return;
        const key = box.dataset.metric;
        if (expandedMetric === key) collapseMetric(); // segundo toque: vuelve
        else expandMetric(key);
    });
    $('big-metric').addEventListener('click', collapseMetric);

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
                .filter(el => el && el.offsetParent !== null)
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
