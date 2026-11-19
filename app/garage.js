'use strict';

// ============================================================
//  GARAJE: FOTO DE LA BICI, REVISIONES Y MANTENIMIENTO
// ============================================================
// Todo se guarda en este dispositivo. Los kilómetros salen de las salidas
// grabadas (las rutas importadas no cuentan, igual que en Estadísticas).

const GARAGE_STORAGE_KEY = 'mtb_pro_garage';
const GARAGE_PHOTO_KEY = 'mtb_pro_garage_photo';
const GARAGE_DEFAULT_INTERVAL_KM = 1000;
const GARAGE_MAX_ENTRIES = 500;
const GARAGE_USAGE_VERSION = 1;
const GARAGE_CHAIN_INTERVAL_KM = 1500;
const GARAGE_TUBELESS_WARNING_MONTHS = 3;
const GARAGE_TUBELESS_INTERVAL_MONTHS = 4;
const GARAGE_SUSPENSION_INTERVAL_SEC = 50 * 60 * 60;
const GARAGE_BRAKE_DESCENT_INTERVAL_M = 15000;
const GARAGE_PHOTO_MAX_SIDE = 1280;
const GARAGE_PHOTO_MAX_BYTES = 450 * 1024;
const GARAGE_PHOTO_MAX_INPUT_BYTES = 20 * 1024 * 1024;

const GARAGE_TYPES = {
    revision: 'Revisión general',
    chain: 'Cadena',
    brakes: 'Frenos / pastillas',
    tyres: 'Neumáticos',
    suspension: 'Suspensión',
    drivetrain: 'Transmisión',
    tubeless: 'Líquido tubeless',
    cleaning: 'Lavado y engrase',
    other: 'Otro'
};

let garageState = { bikeName: '', intervalKm: GARAGE_DEFAULT_INTERVAL_KM, entries: [], usage: null };

function garageEmptyUsage() {
    const componentKm = {};
    Object.keys(GARAGE_TYPES).filter(type => type !== 'revision').forEach(type => { componentKm[type] = 0; });
    return {
        version: GARAGE_USAGE_VERSION,
        latestRouteId: 0,
        totalKm: 0,
        kmSinceRevision: 0,
        componentKm,
        suspensionMovingSec: 0,
        brakeDescentM: 0
    };
}

function garageNormalizeUsage(value) {
    if (!value || typeof value !== 'object' || Number(value.version) !== GARAGE_USAGE_VERSION) return null;
    const usage = garageEmptyUsage();
    const latestRouteId = Number(value.latestRouteId);
    usage.latestRouteId = Number.isSafeInteger(latestRouteId) && latestRouteId > 0 ? latestRouteId : 0;
    ['totalKm', 'kmSinceRevision', 'suspensionMovingSec', 'brakeDescentM'].forEach(key => {
        const number = Number(value[key]);
        usage[key] = Number.isFinite(number) && number > 0 ? number : 0;
    });
    if (value.componentKm && typeof value.componentKm === 'object') {
        Object.keys(usage.componentKm).forEach(type => {
            const number = Number(value.componentKm[type]);
            usage.componentKm[type] = Number.isFinite(number) && number > 0 ? number : 0;
        });
    }
    return usage;
}

function garageIsoDate(value) {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? text : '';
}

function garageTodayIso(now = Date.now()) {
    const date = new Date(now);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Momento a partir del cual las salidas cuentan como posteriores al mantenimiento:
// si es de hoy, desde que se apunta; si es de otro día, desde el final de ese día.
function garageEntryTime(isoDate, now = Date.now()) {
    const date = garageIsoDate(isoDate);
    if (!date) return NaN;
    if (date === garageTodayIso(now)) return now;
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function garageNormalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const date = garageIsoDate(entry.date);
    if (!date) return null;
    const type = Object.prototype.hasOwnProperty.call(GARAGE_TYPES, entry.type) ? entry.type : 'other';
    const at = Number(entry.at);
    const cost = Number(entry.cost);
    return {
        id: String(entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 40),
        type,
        date,
        at: Number.isFinite(at) ? at : garageEntryTime(date),
        cost: Number.isFinite(cost) && cost > 0 ? Math.round(cost * 100) / 100 : 0,
        notes: String(entry.notes || '').trim().slice(0, 200)
    };
}

function garageNormalizeState(value) {
    const source = value && typeof value === 'object' ? value : {};
    const interval = Math.round(Number(source.intervalKm));
    const entries = (Array.isArray(source.entries) ? source.entries : [])
        .map(garageNormalizeEntry)
        .filter(Boolean)
        .sort((a, b) => b.at - a.at)
        .slice(0, GARAGE_MAX_ENTRIES);
    return {
        bikeName: String(source.bikeName || '').trim().slice(0, 60),
        intervalKm: Number.isFinite(interval) && interval >= 50 && interval <= 20000 ? interval : GARAGE_DEFAULT_INTERVAL_KM,
        entries,
        usage: garageNormalizeUsage(source.usage)
    };
}

function garageLatestEntry(entries, type) {
    return (Array.isArray(entries) ? entries : [])
        .filter(entry => entry && entry.type === type)
        .reduce((latest, entry) => !latest || entry.at > latest.at ? entry : latest, null);
}

function garageMaintenanceBaselines(entries) {
    const baselines = {};
    (Array.isArray(entries) ? entries : []).forEach(entry => {
        if (entry && (!baselines[entry.type] || entry.at > baselines[entry.type].at)) {
            baselines[entry.type] = entry;
        }
    });
    return baselines;
}

function garageRideMetrics(route, statisticsEngine) {
    if (!route || typeof route !== 'object' || route.kind === 'imported') return null;
    const started = Date.parse(route.startedAt);
    const time = Number.isFinite(started) ? started : Number(route.id);
    if (!Number.isFinite(time)) return null;

    let descentM = null;
    if (Array.isArray(route.points) && route.points.length > 1) {
        const engine = statisticsEngine
            || (typeof MTBStatisticsEngine !== 'undefined' ? MTBStatisticsEngine : null);
        if (!engine || typeof engine.analyzeRoute !== 'function') {
            throw new Error('No está disponible el análisis de desnivel para el mantenimiento preventivo.');
        }
        const analysis = engine.analyzeRoute(route);
        if (analysis.descentAvailable && Number.isFinite(analysis.descentM)) {
            descentM = Math.max(0, analysis.descentM);
        }
    }

    const km = Number(route.distanceKm);
    const movingTimeSec = Number(route.movingTimeSec);
    const id = Number(route.id);
    return {
        id: Number.isSafeInteger(id) && id > 0 ? id : 0,
        time,
        km: Number.isFinite(km) && km > 0 ? km : 0,
        movingTimeSec: Number.isFinite(movingTimeSec) && movingTimeSec > 0 ? movingTimeSec : 0,
        descentM
    };
}

function garageAccumulateRideUsage(usage, metrics, baselines) {
    usage.totalKm += metrics.km;
    usage.latestRouteId = Math.max(usage.latestRouteId, metrics.id);
    const revision = baselines.revision;
    if (revision && metrics.time > revision.at) usage.kmSinceRevision += metrics.km;

    Object.keys(usage.componentKm).forEach(type => {
        const lastEntry = baselines[type];
        if (lastEntry && metrics.time > lastEntry.at) usage.componentKm[type] += metrics.km;
    });
    const suspension = baselines.suspension;
    if (suspension && metrics.time > suspension.at) usage.suspensionMovingSec += metrics.movingTimeSec;
    const brakes = baselines.brakes;
    if (brakes && metrics.time > brakes.at && metrics.descentM !== null) {
        usage.brakeDescentM += metrics.descentM;
    }
}

function garageBuildUsage(routes, entries, statisticsEngine) {
    const usage = garageEmptyUsage();
    const baselines = garageMaintenanceBaselines(entries);
    (Array.isArray(routes) ? routes : []).forEach(route => {
        const metrics = garageRideMetrics(route, statisticsEngine);
        if (metrics) garageAccumulateRideUsage(usage, metrics, baselines);
    });
    return usage;
}

// Salidas propias con su fecha y kilómetros.
function garageRides(routes) {
    return (Array.isArray(routes) ? routes : [])
        .filter(route => route && route.kind !== 'imported')
        .map(route => {
            const started = Date.parse(route.startedAt);
            const time = Number.isFinite(started) ? started : Number(route.id);
            const km = Number(route.distanceKm);
            return { time, km: Number.isFinite(km) && km > 0 ? km : 0 };
        })
        .filter(ride => Number.isFinite(ride.time));
}

function garageKmSince(rides, time) {
    return rides.reduce((sum, ride) => (ride.time > time ? sum + ride.km : sum), 0);
}

function garageSummary(state, routes) {
    const rides = garageRides(routes);
    const usage = state.usage;
    const totalKm = usage ? usage.totalKm : rides.reduce((sum, ride) => sum + ride.km, 0);
    const costTotal = state.entries.reduce((sum, entry) => sum + entry.cost, 0);
    const lastRevision = state.entries.find(entry => entry.type === 'revision') || null;
    const kmSinceRevision = lastRevision
        ? usage ? usage.kmSinceRevision : garageKmSince(rides, lastRevision.at)
        : null;
    const remainingKm = lastRevision ? state.intervalKm - kmSinceRevision : null;
    const components = [];
    const seen = new Set();
    for (const entry of state.entries) {
        if (entry.type === 'revision' || seen.has(entry.type)) continue;
        seen.add(entry.type);
        components.push({
            type: entry.type,
            label: GARAGE_TYPES[entry.type],
            date: entry.date,
            km: usage ? usage.componentKm[entry.type] : garageKmSince(rides, entry.at)
        });
    }
    return {
        totalKm,
        costTotal: Math.round(costTotal * 100) / 100,
        lastRevision,
        kmSinceRevision,
        remainingKm,
        progress: lastRevision ? Math.min(1, Math.max(0, kmSinceRevision / state.intervalKm)) : 0,
        components
    };
}

function garageAddMonths(timestamp, months) {
    const date = new Date(timestamp);
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + months);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
    return date.getTime();
}

function garagePreventiveAlerts(state, now = Date.now()) {
    const hasUsage = !!state.usage;
    const usage = state.usage || garageEmptyUsage();
    const alerts = [];
    const addUsageAlert = (type, label, value, threshold, warningThreshold, unit) => {
        const lastEntry = garageLatestEntry(state.entries, type);
        if (!lastEntry) {
            alerts.push({ type, label, state: 'unknown', message: 'Registra el último mantenimiento para iniciar el contador.' });
            return;
        }
        if (!hasUsage) {
            alerts.push({ type, label, state: 'unknown', message: 'No se pudieron calcular los datos de uso de las rutas.' });
            return;
        }
        const due = type === 'brakes' ? value > threshold : value >= threshold;
        const status = due ? 'due' : value >= warningThreshold ? 'soon' : 'ok';
        const format = number => unit === 'km'
            ? garageFormatKm(number)
            : unit === 'hours'
                ? `${(number / 3600).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`
                : `${Math.round(number).toLocaleString('es-ES')} m`;
        const amount = format(value);
        const target = format(threshold);
        const message = status === 'due'
            ? `${amount} desde el último mantenimiento; toca revisar.`
            : status === 'soon'
                ? `Próxima revisión a los ${target}; llevas ${amount}.`
                : `${amount} de ${target} desde el último mantenimiento.`;
        alerts.push({ type, label, state: status, message });
    };

    addUsageAlert('chain', 'Cadena', usage.componentKm.chain, GARAGE_CHAIN_INTERVAL_KM, 1200, 'km');

    const tubeless = garageLatestEntry(state.entries, 'tubeless');
    if (!tubeless) {
        alerts.push({
            type: 'tubeless',
            label: 'Líquido tubeless',
            state: 'unknown',
            message: 'Registra la última recarga para iniciar el aviso por tiempo.'
        });
    } else {
        const warningAt = garageAddMonths(tubeless.at, GARAGE_TUBELESS_WARNING_MONTHS);
        const dueAt = garageAddMonths(tubeless.at, GARAGE_TUBELESS_INTERVAL_MONTHS);
        const stateName = now >= dueAt ? 'due' : now >= warningAt ? 'soon' : 'ok';
        const dateText = garageFormatDate(garageTodayIso(dueAt));
        const message = stateName === 'due'
            ? `Han pasado 4 meses desde la recarga; renueva el líquido.`
            : stateName === 'soon'
                ? `Revisa la recarga; toca renovarla antes del ${dateText}.`
                : `Próxima revisión antes del ${dateText}.`;
        alerts.push({ type: 'tubeless', label: 'Líquido tubeless', state: stateName, message });
    }

    addUsageAlert(
        'suspension',
        'Horquilla / amortiguador',
        usage.suspensionMovingSec,
        GARAGE_SUSPENSION_INTERVAL_SEC,
        40 * 60 * 60,
        'hours'
    );
    addUsageAlert(
        'brakes',
        'Pastillas de freno',
        usage.brakeDescentM,
        GARAGE_BRAKE_DESCENT_INTERVAL_M,
        12000,
        'meters'
    );
    return alerts;
}

function garageFormatKm(km) {
    const value = Math.max(0, Number(km) || 0);
    return `${value.toLocaleString('es-ES', { maximumFractionDigits: value < 100 ? 1 : 0 })} km`;
}

function garageFormatDate(isoDate) {
    const [year, month, day] = String(isoDate).split('-');
    return year && month && day ? `${day}/${month}/${year}` : '';
}

function garageFormatCost(cost) {
    return `${(Number(cost) || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        GARAGE_TYPES, garageIsoDate, garageEntryTime, garageNormalizeEntry, garageNormalizeState,
        garageRides, garageKmSince, garageSummary, garageFormatKm, garageBuildUsage,
        garagePreventiveAlerts, garageAddMonths
    };
}

// ------------------------------------------------------------
//  Interfaz
// ------------------------------------------------------------
function garageElement(id) {
    return document.getElementById(id);
}

function garageLoadState() {
    try { garageState = garageNormalizeState(JSON.parse(localStorage.getItem(GARAGE_STORAGE_KEY) || '{}')); }
    catch (error) { garageState = garageNormalizeState({}); }
}

function garagePersist() {
    try {
        localStorage.setItem(GARAGE_STORAGE_KEY, JSON.stringify(garageState));
        return true;
    } catch (error) {
        console.warn('No se pudo guardar el garaje:', error);
        return false;
    }
}

function garageCurrentRoutes() {
    return typeof savedRoutes !== 'undefined' && Array.isArray(savedRoutes) ? savedRoutes : [];
}

function garageStoreUsage(usage) {
    const previous = garageState.usage;
    garageState.usage = usage;
    if (garagePersist()) return true;
    garageState.usage = previous;
    return false;
}

function garageRebuildUsageCache(routes = garageCurrentRoutes()) {
    return garageStoreUsage(garageBuildUsage(routes, garageState.entries));
}

function garageEnsureUsageCache(routes = garageCurrentRoutes()) {
    if (garageState.usage) return true;
    try {
        if (garageRebuildUsageCache(routes)) return true;
        garageShowStatus('No se pudo guardar el cálculo de mantenimiento en este dispositivo.', 'error');
    } catch (error) {
        console.warn('No se pudieron calcular los avisos preventivos:', error);
        garageShowStatus('No se pudieron calcular los avisos de mantenimiento.', 'error');
    }
    return false;
}

function garageRoutesChanged(routes = garageCurrentRoutes()) {
    if (!garageState.usage) return true;
    try {
        return garageRebuildUsageCache(routes);
    } catch (error) {
        console.warn('No se pudo actualizar el uso de mantenimiento tras cambiar las rutas:', error);
        return false;
    }
}

function garageRouteSaved(route) {
    if (!route || route.kind === 'imported') return true;
    const routes = garageCurrentRoutes();
    if (!garageState.usage) return garageEnsureUsageCache(routes);
    const routeId = Number(route.id);
    if (!Number.isSafeInteger(routeId) || routeId <= garageState.usage.latestRouteId) {
        return garageRoutesChanged(routes);
    }
    try {
        const metrics = garageRideMetrics(route);
        if (!metrics) return true;
        const usage = {
            ...garageState.usage,
            componentKm: { ...garageState.usage.componentKm }
        };
        garageAccumulateRideUsage(usage, metrics, garageMaintenanceBaselines(garageState.entries));
        return garageStoreUsage(usage);
    } catch (error) {
        console.warn('No se pudo actualizar el uso de mantenimiento tras guardar la ruta:', error);
        return false;
    }
}

function garageSaveEntries(entries) {
    const previousEntries = garageState.entries;
    const previousUsage = garageState.usage;
    let nextUsage = previousUsage;
    if (previousUsage) nextUsage = garageBuildUsage(garageCurrentRoutes(), entries);
    garageState.entries = entries;
    garageState.usage = nextUsage;
    if (garagePersist()) return true;
    garageState.entries = previousEntries;
    garageState.usage = previousUsage;
    return false;
}

function garageShowStatus(message, state = '') {
    const status = garageElement('garage-status');
    if (!status) return;
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
}

function garageRenderPhoto() {
    const image = garageElement('garage-photo');
    const placeholder = garageElement('garage-photo-placeholder');
    const remove = garageElement('garage-photo-remove');
    const change = garageElement('garage-photo-change');
    let src = '';
    try { src = localStorage.getItem(GARAGE_PHOTO_KEY) || ''; } catch (error) {}
    if (image) {
        if (src) image.src = src; else image.removeAttribute('src');
        image.hidden = !src;
    }
    if (placeholder) placeholder.hidden = !!src;
    if (remove) remove.hidden = !src;
    if (change) change.textContent = src ? 'Cambiar foto' : 'Añadir foto';
}

function garageRenderSummary() {
    const routes = typeof savedRoutes !== 'undefined' ? savedRoutes : [];
    garageEnsureUsageCache(routes);
    const summary = garageSummary(garageState, routes);
    const text = garageElement('garage-summary-text');
    const bar = garageElement('garage-progress-bar');
    const card = document.querySelector('.garage-summary-card');
    let state = 'empty';
    if (text) {
        if (!summary.lastRevision) {
            text.textContent = 'Aún no has registrado ninguna revisión general. Añade una para empezar a contar los kilómetros.';
        } else if (summary.remainingKm > 0) {
            state = summary.progress >= 0.9 ? 'soon' : 'ok';
            text.textContent = `Te quedan ${garageFormatKm(summary.remainingKm)}. Última revisión el ${garageFormatDate(summary.lastRevision.date)}.`;
        } else {
            state = 'due';
            text.textContent = `Toca revisión: llevas ${garageFormatKm(summary.kmSinceRevision)} desde el ${garageFormatDate(summary.lastRevision.date)}.`;
        }
    }
    if (card) card.dataset.state = state;
    if (bar) bar.style.width = `${Math.round(summary.progress * 100)}%`;
    const kmSince = garageElement('garage-km-since');
    if (kmSince) kmSince.textContent = summary.lastRevision ? garageFormatKm(summary.kmSinceRevision) : '—';
    const kmTotal = garageElement('garage-km-total');
    if (kmTotal) kmTotal.textContent = garageFormatKm(summary.totalKm);
    const costTotal = garageElement('garage-cost-total');
    if (costTotal) costTotal.textContent = garageFormatCost(summary.costTotal);
    const interval = garageElement('garage-interval');
    if (interval && document.activeElement !== interval) interval.value = String(garageState.intervalKm);

    const list = garageElement('garage-components');
    if (list) {
        list.replaceChildren(...summary.components.map(component => {
            const item = document.createElement('li');
            const name = document.createElement('strong');
            name.textContent = component.label;
            const detail = document.createElement('span');
            detail.textContent = `${garageFormatKm(component.km)} desde el ${garageFormatDate(component.date)}`;
            item.append(name, detail);
            return item;
        }));
        list.hidden = !summary.components.length;
    }
    const preventiveList = garageElement('garage-preventive-alerts');
    if (preventiveList) {
        preventiveList.replaceChildren(...garagePreventiveAlerts(garageState).map(alert => {
            const item = document.createElement('li');
            item.dataset.state = alert.state;
            const title = document.createElement('strong');
            title.textContent = alert.label;
            const detail = document.createElement('span');
            detail.textContent = alert.message;
            item.append(title, detail);
            return item;
        }));
    }
}

function garageRenderHistory() {
    const list = garageElement('garage-history');
    const empty = garageElement('garage-history-empty');
    if (!list) return;
    const routes = typeof savedRoutes !== 'undefined' ? savedRoutes : [];
    const rides = garageRides(routes);
    list.replaceChildren(...garageState.entries.map(entry => {
        const item = document.createElement('li');
        item.className = 'garage-history-item';
        const body = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = GARAGE_TYPES[entry.type];
        const meta = document.createElement('span');
        const parts = [garageFormatDate(entry.date), `hace ${garageFormatKm(garageKmSince(rides, entry.at))}`];
        if (entry.cost) parts.push(garageFormatCost(entry.cost));
        meta.textContent = parts.join(' · ');
        body.append(title, meta);
        if (entry.notes) {
            const notes = document.createElement('small');
            notes.textContent = entry.notes;
            body.append(notes);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.garageEntry = entry.id;
        remove.textContent = 'Eliminar';
        remove.setAttribute('aria-label', `Eliminar ${GARAGE_TYPES[entry.type]} del ${garageFormatDate(entry.date)}`);
        item.append(body, remove);
        return item;
    }));
    if (empty) empty.hidden = garageState.entries.length > 0;
}

function garageRender() {
    const name = garageElement('garage-bike-name');
    if (name && document.activeElement !== name) name.value = garageState.bikeName;
    garageRenderPhoto();
    garageRenderSummary();
    garageRenderHistory();
}

function garageOpenWorkspace() {
    toolsOpenWorkspace('garage-workspace');
    const date = garageElement('garage-date');
    if (date && !date.value) date.value = garageTodayIso();
    if (date) date.max = garageTodayIso();
    garageRender();
}

function garageCloseWorkspace() {
    toolsCloseWorkspaces();
    if (typeof toolsScrollToTop === 'function') toolsScrollToTop();
}

function garagePhotoToDataUrl(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > GARAGE_PHOTO_MAX_INPUT_BYTES) {
        return Promise.reject(new Error('Elige una imagen JPEG, PNG o WebP de hasta 20 MB.'));
    }
    return createImageBitmap(file).then(async image => {
        try {
            const scale = Math.min(1, GARAGE_PHOTO_MAX_SIDE / Math.max(image.width, image.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('No se pudo preparar la foto.');
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            for (const quality of [0.82, 0.7, 0.58, 0.46]) {
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                if (dataUrl.length * 0.75 <= GARAGE_PHOTO_MAX_BYTES) return dataUrl;
            }
            throw new Error('La foto no se pudo comprimir lo suficiente.');
        } finally {
            image.close();
        }
    });
}

function garageBindUI() {
    garageElement('garage-back')?.addEventListener('click', garageCloseWorkspace);

    const type = garageElement('garage-type');
    if (type) {
        type.replaceChildren(...Object.entries(GARAGE_TYPES).map(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            return option;
        }));
    }

    garageElement('garage-bike-name')?.addEventListener('change', event => {
        garageState.bikeName = String(event.target.value || '').trim().slice(0, 60);
        event.target.value = garageState.bikeName;
        garagePersist();
    });

    garageElement('garage-interval')?.addEventListener('change', event => {
        const value = Math.round(Number(event.target.value));
        if (Number.isFinite(value) && value >= 50 && value <= 20000) {
            garageState.intervalKm = value;
            garagePersist();
        }
        event.target.value = String(garageState.intervalKm);
        garageRenderSummary();
    });

    garageElement('garage-form')?.addEventListener('submit', event => {
        event.preventDefault();
        const dateInput = garageElement('garage-date');
        const costInput = garageElement('garage-cost');
        const notesInput = garageElement('garage-notes');
        const date = garageIsoDate(dateInput?.value);
        if (!date) { garageShowStatus('Elige una fecha válida.', 'error'); return; }
        if (date > garageTodayIso()) { garageShowStatus('La fecha no puede ser futura.', 'error'); return; }
        const entry = garageNormalizeEntry({
            type: type?.value,
            date,
            at: garageEntryTime(date),
            cost: costInput?.value,
            notes: notesInput?.value
        });
        let saved;
        try {
            saved = garageSaveEntries([entry, ...garageState.entries]
                .sort((a, b) => b.at - a.at)
                .slice(0, GARAGE_MAX_ENTRIES));
        } catch (error) {
            console.warn('No se pudieron actualizar los contadores de mantenimiento:', error);
            garageShowStatus('No se pudo actualizar el uso de mantenimiento.', 'error');
            return;
        }
        if (!saved) {
            garageShowStatus('No se pudo guardar en este dispositivo (¿almacenamiento lleno?).', 'error');
            return;
        }
        if (costInput) costInput.value = '';
        if (notesInput) notesInput.value = '';
        garageShowStatus(`${GARAGE_TYPES[entry.type]} guardado.`, 'success');
        garageRender();
    });

    garageElement('garage-history')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-garage-entry]');
        if (!button) return;
        const entry = garageState.entries.find(item => item.id === button.dataset.garageEntry);
        if (!entry) return;
        const message = `¿Eliminar «${GARAGE_TYPES[entry.type]}» del ${garageFormatDate(entry.date)}?`;
        const ok = typeof modal === 'function' ? await modal({ message, ok: 'Eliminar' }) : window.confirm(message);
        if (!ok) return;
        let saved;
        try {
            saved = garageSaveEntries(garageState.entries.filter(item => item.id !== entry.id));
        } catch (error) {
            console.warn('No se pudieron actualizar los contadores de mantenimiento:', error);
            garageShowStatus('No se pudo actualizar el uso de mantenimiento.', 'error');
            return;
        }
        if (!saved) {
            garageShowStatus('No se pudo guardar en este dispositivo (¿almacenamiento lleno?).', 'error');
            return;
        }
        garageShowStatus('Registro eliminado.');
        garageRender();
    });

    const photoInput = garageElement('garage-photo-input');
    photoInput?.addEventListener('change', async () => {
        const file = photoInput.files && photoInput.files[0];
        photoInput.value = '';
        if (!file) return;
        try {
            const dataUrl = await garagePhotoToDataUrl(file);
            localStorage.setItem(GARAGE_PHOTO_KEY, dataUrl);
            garageRenderPhoto();
            garageShowStatus('Foto de la bici guardada.', 'success');
        } catch (error) {
            console.warn('No se pudo guardar la foto de la bici:', error);
            const full = error && (error.name === 'QuotaExceededError' || error.code === 22);
            garageShowStatus(full ? 'No queda espacio en el dispositivo para la foto.' : error.message, 'error');
        }
    });

    garageElement('garage-photo-remove')?.addEventListener('click', async () => {
        const ok = typeof modal === 'function'
            ? await modal({ message: '¿Quitar la foto de la bici?', ok: 'Quitar' })
            : window.confirm('¿Quitar la foto de la bici?');
        if (!ok) return;
        try { localStorage.removeItem(GARAGE_PHOTO_KEY); } catch (error) {}
        garageRenderPhoto();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !garageElement('garage-workspace')?.hidden) garageRender();
    });
}

if (typeof document !== 'undefined') {
    garageLoadState();
    garageBindUI();
}
