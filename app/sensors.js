'use strict';

//  PULSÓMETRO BLUETOOTH
// ============================================================
let bleDevice = null, bleManual = false, webHrGeneration = 0;
let webHrConnectingGeneration = null, webHrReconnecting = false;
const hrToggle = $('sensor-hr-enabled');

function onHrChange(e) {
    const bpm = parseHeartRateMeasurement(e.target && e.target.value);
    if (bpm === null) {
        currentHr = null;
        $('m-hr').textContent = '--';
        setHrConnectionState(true, true, 'Conectado · sin lectura válida, revisa el sensor');
        return;
    }
    currentHr = bpm;
    $('m-hr').textContent = bpm;
    if ($('sensor-hr-status').textContent.includes('sin lectura válida')) {
        setHrConnectionState(true, true, `Conectado: ${(bleDevice && bleDevice.name) || 'Pulsómetro'}`);
    }
}

// En 0x2A37 el bit 0 selecciona uint8/uint16 y los bits 1-2 informan del contacto
// cuando el sensor lo soporta. Una lectura sin contacto no se muestra ni se graba.
function parseHeartRateMeasurement(value) {
    if (!value || value.byteLength < 1) return null;
    const flags = value.getUint8(0);
    const is16Bit = (flags & 0x01) !== 0;
    const valueBytes = is16Bit ? 2 : 1;
    if (value.byteLength < 1 + valueBytes) return null;
    if ((flags & 0x04) !== 0 && (flags & 0x02) === 0) return null;
    const bpm = is16Bit ? value.getUint16(1, true) : value.getUint8(1);
    return Number.isInteger(bpm) && bpm > 0 ? bpm : null;
}

async function connectHr(device) {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const ch = await service.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', onHrChange);
    await ch.startNotifications();
}

async function reconnectHr(device, generation) {
    for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 3000));
        if (bleManual || !hrToggle.checked || generation !== webHrGeneration || bleDevice !== device) return;
        try {
            await connectHr(device);
            if (bleManual || !hrToggle.checked || generation !== webHrGeneration) {
                device.gatt.disconnect();
                return;
            }
            setHrConnectionState(true, true);
            toast('❤️ Pulsómetro reconectado');
            return;
        } catch (e) {
            if (bleManual || !hrToggle.checked || generation !== webHrGeneration) {
                if (device.gatt.connected) device.gatt.disconnect();
                return;
            }
        }
    }
    if (bleManual || !hrToggle.checked || generation !== webHrGeneration || bleDevice !== device) return;
    bleManual = true;
    bleDevice = null;
    setHrConnected(false);
    toast('⚠️ Pulsómetro desconectado', 4000);
}

function onBleDisconnected(e) {
    if (bleDevice !== e.target) return;
    if (bleManual || !hrToggle.checked) {
        bleDevice = null;
        setHrConnected(false);
        return;
    }
    setHrConnectionState(false, true, 'Desconectado, reconectando…');
    toast('⚠️ Pulsómetro desconectado, reconectando…');
    if (webHrReconnecting) return;
    webHrReconnecting = true;
    const generation = webHrGeneration;
    reconnectHr(e.target, generation).finally(() => {
        webHrReconnecting = false;
        if (generation !== webHrGeneration && hrToggle.checked && !bleManual
            && !(bleDevice && bleDevice.gatt.connected)) toggleWebHr(true);
    });
}

// ---- Sensores Bluetooth nativos (solo dentro del APK) ----
// Cada sensor conectado queda registrado (id y nombre). Mientras esté activado, la app intenta
// reconectarlo sola: al abrirla, al volver a primer plano, al empezar a grabar y tras una desconexión.
const isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const SENSOR_REGISTRY_KEY = 'mtb_pro_ble_sensors_v1';
const SENSOR_LEGACY_HR_KEY = 'mtb_pro_hr_device';
const SENSOR_TYPES = ['hr', 'cadence', 'power', 'speed'];
const SENSOR_RECONNECT_MIN_MS = 5000;
const SENSOR_RECONNECT_MAX_MS = 30000;
let nativeBleLoading = null;
const sensorStates = Object.fromEntries(SENSOR_TYPES.map(type => [type, {
    connected: false, connecting: false, generation: 0, deviceId: null, deviceName: '',
    subscription: null, lastReadingAt: 0, previous: null, timer: null, attempt: 0, alerted: false,
    connectingGeneration: null
}]));
const sensorConfigs = {
    hr: { service: '0000180d-0000-1000-8000-00805f9b34fb', characteristic: '00002a37-0000-1000-8000-00805f9b34fb', name: 'Pulsómetro', connect: 'connect' },
    cadence: { service: '00001816-0000-1000-8000-00805f9b34fb', characteristic: '00002a5b-0000-1000-8000-00805f9b34fb', name: 'Cadencia', connect: 'connectCsc' },
    speed: { service: '00001816-0000-1000-8000-00805f9b34fb', characteristic: '00002a5b-0000-1000-8000-00805f9b34fb', name: 'Velocímetro', connect: 'connectCsc' },
    power: { service: '00001818-0000-1000-8000-00805f9b34fb', characteristic: '00002a63-0000-1000-8000-00805f9b34fb', name: 'Potenciómetro', connect: 'connectPower' }
};

// Registro guardado: { tipo: { id, name, enabled } }. Acepta el pulsómetro guardado por versiones anteriores.
function normalizeSensorRegistry(value, legacyHr) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const registry = {};
    SENSOR_TYPES.forEach(type => {
        const entry = source[type];
        if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) return;
        registry[type] = {
            id: entry.id.trim(),
            name: typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : '',
            enabled: entry.enabled !== false
        };
    });
    if (!registry.hr && legacyHr && typeof legacyHr.id === 'string' && legacyHr.id.trim()) {
        registry.hr = { id: legacyHr.id.trim(), name: typeof legacyHr.name === 'string' ? legacyHr.name.trim().slice(0, 60) : '', enabled: true };
    }
    return registry;
}

// Espera entre intentos de reconexión: 5 s, 10 s, 20 s y después cada 30 s mientras siga activado.
function sensorReconnectDelay(attempt) {
    const step = Math.max(0, Math.floor(Number(attempt) || 0));
    return Math.min(SENSOR_RECONNECT_MAX_MS, SENSOR_RECONNECT_MIN_MS * 2 ** Math.min(step, 10));
}

function sensorReadJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (error) { return null; }
}

let sensorRegistry = typeof localStorage !== 'undefined'
    ? normalizeSensorRegistry(sensorReadJson(SENSOR_REGISTRY_KEY), sensorReadJson(SENSOR_LEGACY_HR_KEY))
    : {};

function saveSensorRegistry() {
    try {
        localStorage.setItem(SENSOR_REGISTRY_KEY, JSON.stringify(sensorRegistry));
        localStorage.removeItem(SENSOR_LEGACY_HR_KEY);
    } catch (error) {
        console.warn('No se pudo guardar la lista de sensores:', error);
    }
    renderRegisteredSensors();
}

function sensorLabel(type) {
    const entry = sensorRegistry[type];
    return (entry && entry.name) || sensorConfigs[type].name;
}

function setSensorStatus(type, connected, detail) {
    const state = sensorStates[type];
    state.connected = connected;
    const entry = sensorRegistry[type];
    // El interruptor refleja si el sensor está activado (se conecta solo), no solo si está conectado ahora.
    $(`sensor-${type}-enabled`).checked = connected || Boolean(entry && entry.enabled);
    $(`sensor-${type}-status`).textContent = detail || (connected ? 'Conectado' : 'Desconectado');
}

function clearSensorReading(type) {
    const state = sensorStates[type];
    state.previous = null;
    if (type === 'hr') { currentHr = null; $('m-hr').textContent = '--'; }
    if (type === 'cadence') updateCadence(null);
    if (type === 'power') updatePower(null);
    if (type === 'speed') { currentBleSpeed = null; currentBleSpeedAt = 0; }
}

function onSensorValue(type, value) {
    const state = sensorStates[type];
    if (type === 'hr' && value === null) {
        currentHr = null;
        $('m-hr').textContent = '--';
        setSensorStatus('hr', true, `Conectado: ${state.deviceName || sensorLabel('hr')} · sin lectura válida, revisa el sensor`);
        return;
    }
    state.lastReadingAt = Date.now();
    if (type === 'hr') {
        currentHr = value;
        $('m-hr').textContent = value;
        if ($('sensor-hr-status').textContent.includes('sin lectura válida')) {
            setSensorStatus('hr', true, `Conectado: ${state.deviceName || sensorLabel('hr')}`);
        }
    }
    else if (type === 'power') updatePower(value);
    else applyCscReading(type, value);
}

function clearSensorTimer(type) {
    const state = sensorStates[type];
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
}

// Cada operación de conexión (automática o pedida por el usuario) se identifica con la generación del sensor;
// solo la más reciente puede marcar el sensor como conectado o liberar el indicador de "conectando".
function beginSensorConnection(type, generation) {
    const state = sensorStates[type];
    state.connecting = true;
    state.connectingGeneration = generation;
}

function endSensorConnection(type, generation) {
    const state = sensorStates[type];
    if (state.connectingGeneration !== generation) return;
    state.connecting = false;
    state.connectingGeneration = null;
    // Si el usuario lo reactivó mientras otra operación terminaba, se vuelve a intentar.
    const entry = sensorRegistry[type];
    if (entry && entry.enabled && !state.connected && state.timer === null && generation !== state.generation) {
        scheduleSensorReconnect(type, 0, 300);
    }
}

async function connectSensorDevice(type, device, generation) {
    const state = sensorStates[type], config = sensorConfigs[type];
    const deviceId = device.deviceId || device.id;
    const ble = await loadNativeBle();
    if (generation !== state.generation) return false;
    const subscription = await ble[config.connect](
        deviceId,
        // Las lecturas de una conexión ya sustituida no se publican.
        value => { if (generation === state.generation && state.deviceId === deviceId) onSensorValue(type, value); },
        () => onSensorDisconnected(type, deviceId, generation)
    );
    if (generation !== state.generation) {
        await ble.disconnectCharacteristic(deviceId, config.service, config.characteristic, subscription);
        return false;
    }
    // Si quedaba otra suscripción activa de este tipo, se cierra antes de sustituirla.
    const previousId = state.deviceId, previousSubscription = state.subscription;
    if (previousSubscription && (previousId !== deviceId || previousSubscription !== subscription)) {
        try { await ble.disconnectCharacteristic(previousId, config.service, config.characteristic, previousSubscription); }
        catch (error) { console.warn(`No se pudo cerrar la conexión anterior de ${config.name}:`, error); }
        if (generation !== state.generation) {
            await ble.disconnectCharacteristic(deviceId, config.service, config.characteristic, subscription);
            return false;
        }
    }
    state.deviceId = deviceId;
    state.subscription = subscription;
    state.deviceName = device.name || sensorLabel(type);
    state.lastReadingAt = Date.now();
    state.previous = null;
    state.attempt = 0;
    state.alerted = false;
    sensorRegistry[type] = { id: deviceId, name: device.name || (sensorRegistry[type] && sensorRegistry[type].name) || '', enabled: true };
    saveSensorRegistry();
    setSensorStatus(type, true, `Conectado: ${state.deviceName}`);
    return true;
}

function onSensorDisconnected(type, deviceId, generation) {
    const state = sensorStates[type];
    if (generation !== state.generation || state.deviceId !== deviceId) return;
    state.connected = false;
    state.deviceId = null;
    state.subscription = null;
    clearSensorReading(type);
    const entry = sensorRegistry[type];
    if (!entry || !entry.enabled) {
        setSensorStatus(type, false, 'Desconectado');
        return;
    }
    setSensorStatus(type, false, `Esperando a ${sensorLabel(type)}…`);
    if (!state.alerted) {
        state.alerted = true;
        toast(`⚠️ ${sensorConfigs[type].name} desconectado. Se reconectará cuando esté disponible.`);
    }
    scheduleSensorReconnect(type, 0);
}

function scheduleSensorReconnect(type, attempt, delay = sensorReconnectDelay(attempt)) {
    const state = sensorStates[type];
    clearSensorTimer(type);
    state.attempt = attempt;
    state.timer = setTimeout(() => {
        state.timer = null;
        attemptSensorReconnect(type);
    }, delay);
}

async function attemptSensorReconnect(type) {
    const state = sensorStates[type];
    const entry = sensorRegistry[type];
    if (!isNativeApp() || !entry || !entry.enabled || state.connected || state.connecting) return;
    // Sin grabar y con la app en segundo plano no se gasta batería buscando sensores.
    if (typeof document !== 'undefined' && document.hidden && !(typeof isRecording !== 'undefined' && isRecording)) {
        scheduleSensorReconnect(type, state.attempt, SENSOR_RECONNECT_MAX_MS);
        return;
    }
    const generation = state.generation;
    beginSensorConnection(type, generation);
    try {
        const ble = await loadNativeBle();
        await ble.init();
        if (!(await ble.isEnabled())) {
            if (generation === state.generation) setSensorStatus(type, false, 'Bluetooth apagado: se conectará al activarlo');
            scheduleSensorReconnect(type, state.attempt + 1);
            return;
        }
        if (generation !== state.generation) return;
        setSensorStatus(type, false, `Buscando ${sensorLabel(type)}…`);
        if (await connectSensorDevice(type, { deviceId: entry.id, name: entry.name }, generation)) {
            toast(`✅ ${sensorConfigs[type].name} conectado: ${sensorLabel(type)}`);
            return;
        }
    } catch (error) {
        console.warn(`${sensorConfigs[type].name} no disponible todavía:`, error);
    } finally {
        endSensorConnection(type, generation);
    }
    if (generation !== state.generation || state.connected || !sensorRegistry[type] || !sensorRegistry[type].enabled) return;
    setSensorStatus(type, false, `Esperando a ${sensorLabel(type)}…`);
    scheduleSensorReconnect(type, state.attempt + 1);
}

// Reintenta ya los sensores activados que estén esperando (app en primer plano o inicio de grabación).
function sensorsReconnectNow() {
    if (!isNativeApp()) return;
    SENSOR_TYPES.forEach(type => {
        const state = sensorStates[type];
        const entry = sensorRegistry[type];
        if (entry && entry.enabled && !state.connected && !state.connecting) scheduleSensorReconnect(type, 0, 300);
    });
}

async function enableSensor(type) {
    if (!isNativeApp()) {
        if (type === 'hr') { toggleWebHr(true); return; }
        toast('La conexión de sensores está disponible en la app Android.', 5000);
        $(`sensor-${type}-enabled`).checked = false;
        return;
    }
    const state = sensorStates[type], config = sensorConfigs[type];
    // La intención del usuario se guarda antes de nada, aunque haya otra conexión en curso.
    const saved = sensorRegistry[type];
    if (saved && !saved.enabled) { saved.enabled = true; saveSensorRegistry(); }
    if (state.connected) return;
    clearSensorTimer(type);
    // Sustituye cualquier intento automático en curso: esta operación pasa a ser la única activa.
    const generation = ++state.generation;
    beginSensorConnection(type, generation);
    const toggle = $(`sensor-${type}-enabled`);
    toggle.disabled = true;
    try {
        const ble = await loadNativeBle();
        await ble.init(); // pide los permisos de Bluetooth la primera vez
        if (generation !== state.generation) return;
        if (!(await ble.isEnabled())) throw new Error('Activa el Bluetooth del móvil.');
        // 1) el sensor registrado, si está cerca
        if (saved) {
            setSensorStatus(type, false, `Conectando con ${sensorLabel(type)}…`);
            try {
                if (await connectSensorDevice(type, { deviceId: saved.id, name: saved.name }, generation)) {
                    toast(`✅ ${config.name} conectado: ${sensorLabel(type)}`);
                    return;
                }
                return;
            } catch (error) {
                if (generation !== state.generation) return;
                console.warn(`${config.name} registrado no disponible:`, error);
            }
        }
        // 2) elegir de la lista de dispositivos cercanos
        const device = await ble.pick([config.service]);
        if (generation !== state.generation) return;
        if (await connectSensorDevice(type, device, generation)) {
            toast(`✅ ${config.name} conectado: ${device.name || config.name}`);
        }
    } catch (error) {
        if (generation !== state.generation) return;
        const message = String((error && (error.message || error)) || '');
        console.warn(`No se pudo conectar ${config.name}:`, error);
        if (!/cancel|no device|not found|notfound/i.test(message)) toast(`No se pudo conectar ${config.name}: ${message}`, 6000);
        if (sensorRegistry[type] && sensorRegistry[type].enabled) {
            // Sigue activado: se conectará solo cuando el sensor registrado esté disponible.
            setSensorStatus(type, false, `Esperando a ${sensorLabel(type)}…`);
            scheduleSensorReconnect(type, 0);
        } else {
            setSensorStatus(type, false, 'Desconectado');
        }
    } finally {
        toggle.disabled = false;
        endSensorConnection(type, generation);
    }
}

async function disableSensor(type, { forget = false } = {}) {
    const state = sensorStates[type], config = sensorConfigs[type];
    state.generation++;
    clearSensorTimer(type);
    const deviceId = state.deviceId;
    const subscription = state.subscription;
    state.deviceId = null;
    state.subscription = null;
    state.alerted = false;
    if (sensorRegistry[type]) {
        if (forget) delete sensorRegistry[type];
        else sensorRegistry[type].enabled = false;
        saveSensorRegistry();
    }
    clearSensorReading(type);
    setSensorStatus(type, false, 'Desconectado');
    if (type === 'hr' && !isNativeApp()) { toggleWebHr(false); return; }
    // Si aún está conectando, connectSensorDevice hará la limpieza cuando termine.
    if (!deviceId || !subscription) return;
    try {
        const ble = await loadNativeBle();
        await ble.disconnectCharacteristic(deviceId, config.service, config.characteristic, subscription);
    } catch (error) {
        console.warn(`No se pudo desconectar ${config.name}:`, error);
        toast(`No se pudo desconectar ${config.name}.`, 5000);
    }
}

function renderRegisteredSensors() {
    const list = typeof document !== 'undefined' ? $('sensor-registered') : null;
    if (!list) return;
    list.replaceChildren();
    const types = SENSOR_TYPES.filter(type => sensorRegistry[type]);
    list.hidden = types.length === 0;
    types.forEach(type => {
        const item = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = `${sensorConfigs[type].name}: ${sensorLabel(type)}`;
        const forget = document.createElement('button');
        forget.type = 'button';
        forget.className = 'sensor-forget';
        forget.dataset.sensorForget = type;
        forget.textContent = 'Olvidar';
        forget.setAttribute('aria-label', `Olvidar ${sensorConfigs[type].name} ${sensorLabel(type)}`);
        item.append(label, forget);
        list.append(item);
    });
}

function updateCadence(value) {
    currentCadence = Number.isFinite(value) && value >= 0 && value <= 250 ? Math.round(value) : null;
    $('m-cadence').textContent = currentCadence === null ? '--' : String(currentCadence);
    if (sensorStates.cadence.connected) {
        $('sensor-cadence-status').textContent = currentCadence === null
            ? `Conectado${sensorStates.cadence.deviceName ? ': ' + sensorStates.cadence.deviceName : ''}`
            : `${currentCadence} rpm`;
    }
}

function updatePower(value) {
    currentPower = Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
    $('m-power').textContent = currentPower === null ? '--' : String(currentPower);
    if (sensorStates.power.connected) {
        $('sensor-power-status').textContent = currentPower === null
            ? `Conectado${sensorStates.power.deviceName ? ': ' + sensorStates.power.deviceName : ''}`
            : `${currentPower} W`;
    }
}

function applyCscReading(type, reading) {
    const state = sensorStates[type];
    const now = Date.now();
    state.lastReadingAt = now;
    if (type === 'cadence' && Number.isInteger(reading.crankRevolutions) && Number.isInteger(reading.crankEventTime)) {
        if (state.previous && Number.isInteger(state.previous.crankRevolutions) && Number.isInteger(state.previous.crankEventTime)) {
            const revolutions = (reading.crankRevolutions - state.previous.crankRevolutions + 65536) % 65536;
            const ticks = (reading.crankEventTime - state.previous.crankEventTime + 65536) % 65536;
            if (ticks > 0) updateCadence(revolutions * 60 * 1024 / ticks);
        }
    }
    if (type === 'speed' && Number.isInteger(reading.wheelRevolutions) && Number.isInteger(reading.wheelEventTime)) {
        if (state.previous && Number.isInteger(state.previous.wheelRevolutions) && Number.isInteger(state.previous.wheelEventTime)) {
            const revolutions = (reading.wheelRevolutions - state.previous.wheelRevolutions) >>> 0;
            const ticks = (reading.wheelEventTime - state.previous.wheelEventTime + 65536) % 65536;
            const circumference = Number($('sensor-wheel-circumference').value);
            if (ticks > 0 && Number.isFinite(circumference) && circumference >= 500 && circumference <= 3000) {
                currentBleSpeed = revolutions * circumference * 1024 * 3.6 / (ticks * 1000);
                currentBleSpeedAt = now;
                $('sensor-speed-status').textContent = `${currentBleSpeed.toFixed(1)} km/h`;
            }
        }
    }
    state.previous = reading;
}


function initSensorConnections() {
    const circumference = $('sensor-wheel-circumference');
    const savedCircumference = Number(localStorage.getItem('mtb_pro_wheel_circumference'));
    if (savedCircumference >= 500 && savedCircumference <= 3000) circumference.value = String(savedCircumference);
    circumference.addEventListener('change', () => {
        const value = Number(circumference.value);
        if (!Number.isFinite(value) || value < 500 || value > 3000) {
            circumference.value = '2100';
            toast('La circunferencia debe estar entre 500 y 3000 mm.');
            return;
        }
        localStorage.setItem('mtb_pro_wheel_circumference', String(value));
        if (typeof queueCloudPreferencesSync === 'function') queueCloudPreferencesSync();
    });
    for (const type of SENSOR_TYPES) {
        $(`sensor-${type}-enabled`).addEventListener('change', event => {
            if (event.target.checked) enableSensor(type);
            else disableSensor(type);
        });
    }
    $('sensor-registered')?.addEventListener('click', event => {
        const button = event.target.closest('[data-sensor-forget]');
        if (!button) return;
        const type = button.dataset.sensorForget;
        if (!SENSOR_TYPES.includes(type)) return;
        disableSensor(type, { forget: true });
        toast(`${sensorConfigs[type].name} olvidado. Actívalo para elegir otro dispositivo.`);
    });
    renderRegisteredSensors();
    if (!isNativeApp()) return;
    // Al abrir la app, los sensores registrados y activados se conectan solos cuando estén disponibles.
    SENSOR_TYPES.forEach((type, index) => {
        const entry = sensorRegistry[type];
        if (!entry || !entry.enabled) return;
        setSensorStatus(type, false, `Esperando a ${sensorLabel(type)}…`);
        scheduleSensorReconnect(type, 0, 1500 + index * 700);
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) sensorsReconnectNow();
    });
}

function loadNativeBle() {
    if (window.MtbBle) return Promise.resolve(window.MtbBle);
    if (!nativeBleLoading) {
        nativeBleLoading = new Promise((res, rej) => {
            const sc = document.createElement('script');
            sc.src = 'lib/ble.js';
            sc.onload = () => window.MtbBle ? res(window.MtbBle) : rej(new Error('Falta el módulo Bluetooth'));
            sc.onerror = () => { nativeBleLoading = null; rej(new Error('No se pudo cargar el módulo Bluetooth')); };
            document.head.appendChild(sc);
        });
    }
    return nativeBleLoading;
}

function setHrConnected(on) {
    setHrConnectionState(on, on);
}

function setHrConnectionState(connected, desiredConnected, detail = '') {
    hrToggle.checked = desiredConnected;
    $('sensor-hr-status').textContent = detail || (connected ? 'Conectado' : 'Desconectado');
    if (!connected) { $('m-hr').textContent = '--'; currentHr = null; }
}

async function toggleWebHr(shouldConnect = hrToggle.checked) {
    if (!shouldConnect) {
        webHrGeneration++;
        bleManual = true;
        const device = bleDevice;
        bleDevice = null;
        if (device && device.gatt.connected) device.gatt.disconnect();
        setHrConnected(false);
        return;
    }
    if (webHrConnectingGeneration !== null || webHrReconnecting) {
        bleManual = false;
        webHrGeneration++;
        return;
    }
    if (!navigator.bluetooth) {
        toast('Aquí no hay Web Bluetooth. Para usar el pulsómetro abre la app web en Chrome (Android).', 6000);
        setHrConnected(false);
        return;
    }
    if (bleDevice && bleDevice.gatt.connected) {
        setHrConnectionState(true, true);
        return;
    }
    const generation = ++webHrGeneration;
    webHrConnectingGeneration = generation;
    let device = null;
    try {
        hrToggle.style.opacity = '0.5';
        bleManual = false;
        device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
        if (generation !== webHrGeneration || !hrToggle.checked) return;
        bleDevice = device;
        device.addEventListener('gattserverdisconnected', onBleDisconnected);
        await connectHr(device);
        if (generation !== webHrGeneration || !hrToggle.checked) {
            device.gatt.disconnect();
            return;
        }
        setHrConnectionState(true, true);
        toast(`✅ Conectado a: ${device.name || 'Pulsómetro'}`);
    } catch (err) {
        if (generation !== webHrGeneration || bleManual) {
            if (device && device.gatt.connected) device.gatt.disconnect();
            if (bleDevice === device) bleDevice = null;
            return;
        }
        console.warn('Error BLE:', err);
        if (bleDevice && bleDevice.gatt.connected) bleDevice.gatt.disconnect();
        bleDevice = null;
        setHrConnected(false);
        if (err.name !== 'NotFoundError') toast('No se pudo conectar el pulsómetro', 4000);
    } finally {
        if (webHrConnectingGeneration === generation) {
            webHrConnectingGeneration = null;
            hrToggle.style.opacity = '1';
            if (generation !== webHrGeneration && hrToggle.checked && !bleManual) toggleWebHr(true);
        }
    }
}

// ============================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeSensorRegistry, sensorReconnectDelay };
}
