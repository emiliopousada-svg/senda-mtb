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

let garageState = { bikeName: '', intervalKm: GARAGE_DEFAULT_INTERVAL_KM, entries: [] };

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
        entries
    };
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
    const totalKm = rides.reduce((sum, ride) => sum + ride.km, 0);
    const costTotal = state.entries.reduce((sum, entry) => sum + entry.cost, 0);
    const lastRevision = state.entries.find(entry => entry.type === 'revision') || null;
    const kmSinceRevision = lastRevision ? garageKmSince(rides, lastRevision.at) : null;
    const remainingKm = lastRevision ? state.intervalKm - kmSinceRevision : null;
    const components = [];
    const seen = new Set();
    for (const entry of state.entries) {
        if (entry.type === 'revision' || seen.has(entry.type)) continue;
        seen.add(entry.type);
        components.push({ type: entry.type, label: GARAGE_TYPES[entry.type], date: entry.date, km: garageKmSince(rides, entry.at) });
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
        garageRides, garageKmSince, garageSummary, garageFormatKm
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
        const previous = garageState.entries;
        garageState.entries = [entry, ...previous].sort((a, b) => b.at - a.at).slice(0, GARAGE_MAX_ENTRIES);
        if (!garagePersist()) {
            garageState.entries = previous;
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
        garageState.entries = garageState.entries.filter(item => item.id !== entry.id);
        garagePersist();
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
