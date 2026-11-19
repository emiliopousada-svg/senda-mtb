'use strict';

const cockpitMetricBindings = [
    ['m-time', 'cockpit-time'],
    ['m-dist', 'cockpit-distance'],
    ['m-elevation', 'cockpit-elevation'],
    ['m-avg-speed', 'cockpit-avg-speed'],
    ['m-moving', 'cockpit-moving'],
    ['m-hr', 'cockpit-heart-rate'],
    ['m-cadence', 'cockpit-cadence'],
    ['m-power', 'cockpit-power']
];
const cockpitSensorBindings = [
    ['hr', 'cockpit-sensor-hr', 'sensor-hr-status'],
    ['cadence', 'cockpit-sensor-cadence', 'sensor-cadence-status'],
    ['power', 'cockpit-sensor-power', 'sensor-power-status']
];
const COCKPIT_OLED_SAVER_KEY = 'mtb_pro_oled_saver';

function cockpitOledSaverEnabled() {
    return localStorage.getItem(COCKPIT_OLED_SAVER_KEY) === '1';
}

function cockpitUpdateOledSaver() {
    const page = $('page-cockpit');
    const button = $('cockpit-oled-toggle');
    const status = $('cockpit-oled-status');
    if (!page || !button || !status) return;
    const enabled = cockpitOledSaverEnabled();
    page.classList.toggle('oled-saver', enabled);
    if (document.body.classList) {
        document.body.classList.toggle('cockpit-oled-saver', enabled && currentPage === 6);
    }
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? 'Desactivar ahorro OLED' : 'Activar ahorro OLED');
    status.textContent = enabled ? 'ON' : 'OFF';
}

function cockpitInitOledSaver() {
    const button = $('cockpit-oled-toggle');
    if (!button) return;
    button.addEventListener('click', () => {
        const enabled = !cockpitOledSaverEnabled();
        localStorage.setItem(COCKPIT_OLED_SAVER_KEY, enabled ? '1' : '0');
        cockpitUpdateOledSaver();
        if (typeof screenScheduleDim === 'function') screenScheduleDim();
        toast(enabled ? 'Ahorro OLED activado' : 'Ahorro OLED desactivado');
    });
    cockpitUpdateOledSaver();
}

function cockpitRenderRoute() {
    const line = $('cockpit-route-line');
    const start = $('cockpit-route-start');
    const end = $('cockpit-route-end');
    const empty = $('cockpit-route-empty');
    const title = $('cockpit-route-title');
    if (!line || !start || !end || !empty || !title) return;

    const routePoints = Array.isArray(points)
        ? points.filter(point => Array.isArray(point)
            && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        : [];
    title.textContent = isRecording ? 'Trazado en directo' : routePoints.length ? 'Último trazado' : 'Tu recorrido';
    if (!routePoints.length) {
        line.setAttribute('d', '');
        start.hidden = true;
        end.hidden = true;
        empty.hidden = false;
        return;
    }

    const step = Math.max(1, Math.ceil(routePoints.length / 300));
    const samples = routePoints.filter((_, index) => index % step === 0);
    if (samples[samples.length - 1] !== routePoints[routePoints.length - 1]) {
        samples.push(routePoints[routePoints.length - 1]);
    }
    const latitudes = samples.map(point => point[0]);
    const longitudes = samples.map(point => point[1]);
    const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
    const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
    const latRange = Math.max(maxLat - minLat, 0.00001);
    const lonRange = Math.max(maxLon - minLon, 0.00001);
    const coordinates = samples.map(point => ({
        x: 8 + (point[1] - minLon) / lonRange * 84,
        y: 56 - (point[0] - minLat) / latRange * 48
    }));
    line.setAttribute('d', coordinates.map((point, index) =>
        `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`
    ).join(' '));
    start.setAttribute('cx', coordinates[0].x.toFixed(2));
    start.setAttribute('cy', coordinates[0].y.toFixed(2));
    end.setAttribute('cx', coordinates[coordinates.length - 1].x.toFixed(2));
    end.setAttribute('cy', coordinates[coordinates.length - 1].y.toFixed(2));
    start.hidden = false;
    end.hidden = false;
    empty.hidden = true;
}

function cockpitRender() {
    cockpitMetricBindings.forEach(([sourceId, targetId]) => {
        const source = $(sourceId);
        const target = $(targetId);
        if (source && target) target.textContent = source.textContent.trim() || '—';
    });

    const connections = typeof sensorStates === 'undefined' ? null : sensorStates;
    cockpitSensorBindings.forEach(([type, targetId]) => {
        const target = $(targetId);
        const state = connections && connections[type];
        if (target) target.classList.toggle('connected', Boolean(state && state.connected));
    });

    const speedSource = $('m-speed');
    const speed = speedSource ? speedSource.textContent.trim() : '0.0';
    const speedValue = Number.parseFloat(speed.replace(',', '.'));
    const gauge = $('cockpit-speed-gauge');
    const speedTarget = $('cockpit-speed');
    const speedPanel = $('cockpit-speed-panel');
    if (speedTarget) speedTarget.textContent = speed || '0.0';
    if (gauge) {
        const normalizedSpeed = Number.isFinite(speedValue) ? Math.min(Math.max(speedValue, 0), 60) : 0;
        const angle = normalizedSpeed / 60 * 270;
        gauge.style.setProperty('--speed-angle', `${angle.toFixed(1)}deg`);
        gauge.setAttribute('aria-label', `Velocidad actual ${speed || '0.0'} km/h`);
        if (speedPanel) {
            speedPanel.dataset.speedBand = normalizedSpeed < 8 ? 'blue'
                : normalizedSpeed < 15 ? 'green'
                    : normalizedSpeed < 25 ? 'yellow'
                        : normalizedSpeed < 40 ? 'orange'
                            : 'red';
        }
    }

    const active = Boolean(isRecording);
    const paused = active && Boolean(isPaused);
    const state = $('cockpit-recording-state');
    if (state) {
        state.dataset.state = !active ? 'idle' : paused ? 'paused' : 'recording';
        state.textContent = !active ? 'Sin grabar' : paused ? 'Grabación pausada' : 'Grabando ruta';
    }
    const gpsSource = $('dashboard-gps-status');
    const gpsTarget = $('cockpit-gps-status');
    if (gpsSource && gpsTarget) {
        gpsTarget.textContent = gpsSource.textContent.replace(/\s+/g, ' ').trim();
        gpsTarget.classList.toggle('ready', gpsSource.classList.contains('ready'));
    }
    const networkSource = $('dashboard-network-status');
    const networkTarget = $('cockpit-network-status');
    const networkLabel = $('cockpit-network-label');
    if (networkSource && networkTarget && networkLabel) {
        networkLabel.textContent = networkSource.textContent.replace(/\s+/g, ' ').trim();
        networkTarget.classList.toggle('connected', networkSource.classList.contains('connected'));
        networkTarget.classList.toggle('offline', networkSource.classList.contains('offline'));
        networkTarget.setAttribute('aria-label', networkSource.getAttribute('aria-label') || networkLabel.textContent);
    }

    const altitude = $('recording-live-altitude');
    const altitudeTarget = $('cockpit-profile-altitude');
    if (altitude && altitudeTarget) altitudeTarget.textContent = active ? altitude.textContent : '-- m';
    const elevationHint = $('recording-live-hint');
    const elevationRange = $('cockpit-elevation-range');
    if (elevationHint && elevationRange) elevationRange.textContent = active ? elevationHint.textContent : '-- m';
    const sourceLine = $('recording-live-line');
    const sourceArea = $('recording-live-area');
    const profileLine = $('cockpit-profile-line');
    const profileArea = $('cockpit-profile-area');
    const profileEmpty = $('cockpit-profile-empty');
    const profilePath = sourceLine ? sourceLine.getAttribute('d') || '' : '';
    if (profileLine) profileLine.setAttribute('d', profilePath);
    if (profileArea) profileArea.setAttribute('d', sourceArea ? sourceArea.getAttribute('d') || '' : '');
    if (profileEmpty) profileEmpty.hidden = Boolean(active && profilePath);

    cockpitRenderRoute();
}

cockpitInitOledSaver();

if (typeof MutationObserver !== 'undefined') {
    const cockpitObserver = new MutationObserver(cockpitRender);
    [
        ...cockpitMetricBindings.map(([sourceId]) => $(sourceId)),
        ...cockpitSensorBindings.map(([, , statusId]) => $(statusId)),
        $('m-speed'),
        $('dashboard-gps-status'),
        $('dashboard-network-status'),
        $('recording-live-profile'),
        $('recording-live-altitude'),
        $('recording-live-hint'),
        $('recording-live-line'),
        $('recording-live-area'),
        $('lbl-start'),
        $('btn-stop')
    ].filter(Boolean).forEach(element => cockpitObserver.observe(element, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true
    }));
}

cockpitRender();
