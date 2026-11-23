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
    const gpsLabel = $('cockpit-gps-label');
    if (gpsSource && gpsTarget && gpsLabel) {
        const quality = Number(gpsSource.getAttribute('data-gps-quality'));
        const normalizedQuality = Number.isInteger(quality) ? Math.min(Math.max(quality, 0), 4) : 0;
        gpsLabel.textContent = gpsSource.textContent.replace(/\s+/g, ' ').trim();
        gpsTarget.dataset.gpsQuality = String(normalizedQuality);
        gpsTarget.classList.toggle('ready', normalizedQuality > 0);
        gpsTarget.setAttribute('aria-label', gpsSource.getAttribute('aria-label') || gpsLabel.textContent);
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
