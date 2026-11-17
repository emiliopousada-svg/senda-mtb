'use strict';

const RECORDING_PANEL_KEY = 'mtb_pro_recording_panel_v1';
const RECORDING_PANEL_VISIBLE_KEY = 'mtb_pro_recording_panel_visible_v1';
const RECORDING_PANEL_METRICS = [
    { id: 'speed', label: 'Velocidad' },
    { id: 'dist', label: 'Distancia' },
    { id: 'elev', label: 'Desnivel positivo' },
    { id: 'hr', label: 'Frecuencia cardíaca' },
    { id: 'cadence', label: 'Cadencia' },
    { id: 'power', label: 'Potencia' },
    { id: 'avg-speed', label: 'Velocidad media' },
    { id: 'moving', label: 'Tiempo en movimiento' }
];
let recordingPanelPreferences = RECORDING_PANEL_METRICS.map(metric => metric.id);

function normalizeRecordingPanelPreferences(value) {
    const allowed = new Set(RECORDING_PANEL_METRICS.map(metric => metric.id));
    const result = Array.isArray(value) ? value.filter((id, index) => allowed.has(id) && value.indexOf(id) === index) : [];
    RECORDING_PANEL_METRICS.forEach(metric => {
        if (!result.includes(metric.id)) result.push(metric.id);
    });
    return result;
}

function applyRecordingPanelPreferences() {
    const bar = document.querySelector('.metrics-bar');
    if (!bar) return;
    const visible = recordingPanelPreferences.filter(id =>
        document.querySelector(`.m-box[data-metric="${id}"]`)?.dataset.metricVisible !== 'false'
    );
    const count = Math.max(1, visible.length);
    // Panel inferior del mapa: hasta 5 métricas en una fila; con más, dos filas equilibradas.
    const columns = count <= 5 ? count : Math.ceil(count / 2);
    bar.style.setProperty('--recording-metric-columns', String(columns));
    recordingPanelPreferences.forEach((id, index) => {
        const box = bar.querySelector(`.m-box[data-metric="${id}"]`);
        if (!box) return;
        box.hidden = box.dataset.metricVisible === 'false';
        box.style.order = String(index);
        box.setAttribute('aria-hidden', String(box.hidden));
        box.tabIndex = 0;
    });
}

function saveRecordingPanelPreferences() {
    try { localStorage.setItem(RECORDING_PANEL_KEY, JSON.stringify(recordingPanelPreferences)); }
    catch (error) { console.warn('No se pudo guardar el orden de las métricas:', error); }
    if (typeof queueCloudPreferencesSync === 'function') queueCloudPreferencesSync();
}

function saveRecordingPanelVisibility() {
    const visible = [...document.querySelectorAll('.m-box[data-metric]')]
        .filter(box => box.dataset.metricVisible !== 'false')
        .map(box => box.dataset.metric);
    try { localStorage.setItem(RECORDING_PANEL_VISIBLE_KEY, JSON.stringify(visible)); }
    catch (error) { console.warn('No se pudo guardar la visibilidad de las métricas:', error); }
    if (typeof queueCloudPreferencesSync === 'function') queueCloudPreferencesSync();
}

function renderRecordingPanelSettings() {
    const container = $('recording-metric-config');
    if (!container) return;
    container.replaceChildren();
    RECORDING_PANEL_METRICS.forEach(metric => {
        const index = recordingPanelPreferences.indexOf(metric.id);
        const row = document.createElement('div');
        row.className = 'recording-metric-row';
        const label = document.createElement('label');
        label.className = 'recording-metric-choice';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = document.querySelector(`.m-box[data-metric="${metric.id}"]`)?.dataset.metricVisible !== 'false';
        checkbox.dataset.metricVisible = metric.id;
        label.append(checkbox, document.createTextNode(metric.label));
        const controls = document.createElement('span');
        controls.className = 'recording-metric-order';
        [['up', 'Subir'], ['down', 'Bajar']].forEach(([direction, labelText]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-small secondary';
            button.dataset.metricMove = direction;
            button.dataset.metric = metric.id;
            button.textContent = direction === 'up' ? '↑' : '↓';
            button.setAttribute('aria-label', `${labelText} ${metric.label}`);
            button.disabled = direction === 'up' ? index === 0 : index === RECORDING_PANEL_METRICS.length - 1;
            controls.appendChild(button);
        });
        row.append(label, controls);
        container.appendChild(row);
    });
}

function initRecordingPanelSettings() {
    try { recordingPanelPreferences = normalizeRecordingPanelPreferences(JSON.parse(localStorage.getItem(RECORDING_PANEL_KEY) || 'null')); }
    catch (error) { recordingPanelPreferences = normalizeRecordingPanelPreferences(null); }
    let visibleMetrics = new Set([...document.querySelectorAll('.m-box[data-metric]')]
        .filter(box => box.dataset.defaultVisible !== 'false').map(box => box.dataset.metric));
    try {
        const saved = JSON.parse(localStorage.getItem(RECORDING_PANEL_VISIBLE_KEY) || 'null');
        if (Array.isArray(saved)) visibleMetrics = new Set(saved);
    } catch (error) {}
    if (!RECORDING_PANEL_METRICS.some(metric => visibleMetrics.has(metric.id))) {
        visibleMetrics = new Set([...document.querySelectorAll('.m-box[data-metric]')]
            .filter(box => box.dataset.defaultVisible !== 'false').map(box => box.dataset.metric));
    }
    document.querySelectorAll('.m-box[data-metric]').forEach(box => {
        if (!RECORDING_PANEL_METRICS.some(metric => metric.id === box.dataset.metric)) return;
        box.dataset.metricVisible = String(visibleMetrics.has(box.dataset.metric));
    });
    renderRecordingPanelSettings();
    applyRecordingPanelPreferences();
    const container = $('recording-metric-config');
    if (!container || container.dataset.initialized) return;
    container.dataset.initialized = 'true';
    container.addEventListener('change', event => {
        const checkbox = event.target.closest('[data-metric-visible]');
        if (!checkbox) return;
        const visibleBoxes = [...document.querySelectorAll('.m-box[data-metric]')]
            .filter(box => box.dataset.metricVisible !== 'false');
        if (!checkbox.checked && visibleBoxes.length <= 1) {
            checkbox.checked = true;
            toast('Mantén al menos una métrica visible en el panel.');
            return;
        }
        const box = document.querySelector(`.m-box[data-metric="${checkbox.dataset.metricVisible}"]`);
        if (box) box.dataset.metricVisible = String(checkbox.checked);
        saveRecordingPanelVisibility();
        applyRecordingPanelPreferences();
    });
    container.addEventListener('click', event => {
        const button = event.target.closest('[data-metric-move]');
        if (!button) return;
        const from = recordingPanelPreferences.indexOf(button.dataset.metric);
        const to = from + (button.dataset.metricMove === 'up' ? -1 : 1);
        if (from < 0 || to < 0 || to >= recordingPanelPreferences.length) return;
        [recordingPanelPreferences[from], recordingPanelPreferences[to]] = [recordingPanelPreferences[to], recordingPanelPreferences[from]];
        saveRecordingPanelPreferences();
        applyRecordingPanelPreferences();
        renderRecordingPanelSettings();
    });
}
