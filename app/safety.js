'use strict';

const SAFETY_CONTACTS_KEY = 'mtb_pro_safety_contacts';
const SAFETY_SETTINGS_KEY = 'mtb_pro_safety_settings';
// Restos del antiguo "Aviso de salida" (temporizador y aviso local), que ya no existe.
const SAFETY_LEGACY_SESSION_KEY = 'mtb_pro_safety_session';
const SAFETY_LEGACY_NOTIFICATION_ID = 2480116;
const SAFETY_MAX_CONTACTS = 5;

function safetyNormalizePhone(value) {
    const compact = String(value || '').trim().replace(/[\s()-]/g, '');
    if (!/^\+?[1-9]\d{6,14}$/.test(compact)) return null;
    return compact.startsWith('+') ? compact : `+${compact}`;
}

// Lista de contactos válida: hasta SAFETY_MAX_CONTACTS, nombre de 1-40 caracteres, teléfono internacional y sin duplicados.
function safetyNormalizeContacts(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const result = [];
    value.forEach(contact => {
        if (result.length >= SAFETY_MAX_CONTACTS || !contact || typeof contact.name !== 'string') return;
        const name = contact.name.trim().slice(0, 40);
        const phone = safetyNormalizePhone(contact.phone);
        if (!name || !phone || seen.has(phone)) return;
        seen.add(phone);
        result.push({ name, phone });
    });
    return result;
}

function safetyBuildWhatsAppUrl(contact, message) {
    const phone = safetyNormalizePhone(contact && contact.phone);
    if (!phone) throw new Error('El teléfono no tiene un formato internacional válido.');
    return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(String(message || ''))}`;
}

function safetyBuildSOSMessage(location = {}) {
    const lines = [
        'SOS de senda-mtb: necesito ayuda durante una salida.',
        `Hora del aviso: ${new Date().toLocaleString('es-ES')}`
    ];
    const { lat, lon, updatedAt, accuracy } = location;
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90
        && Number.isFinite(lon) && lon >= -180 && lon <= 180) {
        const updatedText = Number.isFinite(updatedAt) && updatedAt > 0
            ? `Última ubicación conocida, actualizada ${new Date(updatedAt).toLocaleString('es-ES')}`
            : 'Última ubicación conocida';
        const accuracyText = Number.isFinite(accuracy) && accuracy > 0
            ? ` (precisión aproximada ±${Math.round(accuracy)} m)`
            : '';
        lines.push(`${updatedText}${accuracyText}: https://maps.google.com/?q=${lat},${lon}`);
    } else {
        lines.push('La aplicación no dispone de una ubicación conocida.');
    }
    return lines.join('\n');
}

let safetyContacts = [];
let safetySettings = { groupLiveTracking: true };
let safetyContactFormOpen = false;

function safetyElement(id) {
    return document.getElementById(id);
}

function safetyShowStatus(message, state = '') {
    const status = safetyElement('safety-status');
    if (!status) return;
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
}

function safetySaveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function safetyAccountReady() {
    return typeof Cloud !== 'undefined' && typeof Cloud.loggedIn === 'function' && Cloud.loggedIn();
}

function safetyReadStoredContacts() {
    const value = localStorage.getItem(SAFETY_CONTACTS_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('La lista de contactos guardada no es válida.');
    return parsed;
}

function safetyLoadState() {
    try {
        const stored = safetyReadStoredContacts();
        safetyContacts = safetyNormalizeContacts(stored);
        if (safetyContacts.length !== stored.length) {
            safetyShowStatus('Se omitieron contactos guardados que no tenían datos válidos o superaban el límite permitido.', 'error');
        }
        const settingsValue = localStorage.getItem(SAFETY_SETTINGS_KEY);
        if (settingsValue) {
            const parsedSettings = JSON.parse(settingsValue);
            if (!parsedSettings || typeof parsedSettings !== 'object') throw new Error('La configuración de seguridad guardada no es válida.');
            safetySettings = {
                groupLiveTracking: typeof parsedSettings.groupLiveTracking === 'boolean' ? parsedSettings.groupLiveTracking : true
            };
        }
    } catch (error) {
        console.error('No se pudo cargar la configuración de seguridad:', error);
        safetyShowStatus('No se pudieron leer todos los datos guardados. Revisa el almacenamiento local de esta aplicación.', 'error');
    }
    safetyClearLegacySession();
}

// Limpia una protección temporizada que hubiera quedado guardada de versiones anteriores.
function safetyClearLegacySession() {
    let pending = false;
    try { pending = localStorage.getItem(SAFETY_LEGACY_SESSION_KEY) !== null; }
    catch (error) { return; }
    if (!pending) return;
    const capacitor = typeof window !== 'undefined' ? window.Capacitor : null;
    const native = Boolean(capacitor && typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform());
    const plugin = capacitor && capacitor.Plugins && capacitor.Plugins.LocalNotifications;
    const forget = () => {
        try { localStorage.removeItem(SAFETY_LEGACY_SESSION_KEY); }
        catch (error) { console.warn('No se pudo borrar la protección antigua guardada:', error); }
    };
    // Fuera de la app nativa no hay avisos programados que cancelar.
    if (!native) { forget(); return; }
    // En la app se conserva la marca hasta cancelar el aviso, para reintentarlo en el próximo arranque.
    if (!plugin || typeof plugin.cancel !== 'function') return;
    Promise.resolve(plugin.cancel({ notifications: [{ id: SAFETY_LEGACY_NOTIFICATION_ID }] }))
        .then(forget)
        .catch(error => console.warn('No se pudo cancelar el aviso antiguo de seguridad:', error));
}

// Los contactos viajan con las preferencias privadas de la cuenta (cloud-preferences.js).
function safetySetContacts(contacts) {
    safetyContacts = safetyNormalizeContacts(contacts);
    safetySaveJson(SAFETY_CONTACTS_KEY, safetyContacts);
    safetyRenderContacts();
}

const SAFETY_CONTACTS_UNSYNCED_KEY = 'mtb_pro_safety_contacts_unsynced';

function safetyReadContactList(key) {
    try { return safetyNormalizeContacts(JSON.parse(localStorage.getItem(key) || '[]')); }
    catch (error) { return []; }
}

// Sin sesión solo se apuntan los contactos añadidos en ese momento; al iniciar sesión se suman a la
// cuenta. Los que ya estaban (de una cuenta anterior) nunca pasan a otra cuenta.
function safetyTrackSignedOutContacts(previous) {
    const before = new Set(previous.map(contact => contact.phone));
    const marked = new Set(safetyReadContactList(SAFETY_CONTACTS_UNSYNCED_KEY).map(contact => contact.phone));
    const added = safetyContacts.filter(contact => marked.has(contact.phone) || !before.has(contact.phone));
    if (added.length) safetySaveJson(SAFETY_CONTACTS_UNSYNCED_KEY, added);
    else localStorage.removeItem(SAFETY_CONTACTS_UNSYNCED_KEY);
}

// Con sesión no se apuntan altas nuevas, pero un contacto borrado deja de estar pendiente de subir.
function safetyForgetDeletedSignedOutContacts() {
    const marked = safetyReadContactList(SAFETY_CONTACTS_UNSYNCED_KEY);
    if (!marked.length) return;
    const current = new Set(safetyContacts.map(contact => contact.phone));
    const kept = marked.filter(contact => current.has(contact.phone));
    if (kept.length) safetySaveJson(SAFETY_CONTACTS_UNSYNCED_KEY, kept);
    else localStorage.removeItem(SAFETY_CONTACTS_UNSYNCED_KEY);
}

function safetyPersistContacts() {
    const previous = safetyReadContactList(SAFETY_CONTACTS_KEY);
    safetySaveJson(SAFETY_CONTACTS_KEY, safetyContacts);
    if (!safetyAccountReady()) safetyTrackSignedOutContacts(previous);
    else safetyForgetDeletedSignedOutContacts();
    if (typeof queueCloudPreferencesSync === 'function') queueCloudPreferencesSync();
}

function safetyContactsSavedMessage(action) {
    return safetyAccountReady()
        ? `${action}. Se sincroniza con tu cuenta.`
        : `${action} en este móvil. Inicia sesión para guardarlo en tu cuenta.`;
}

function safetyRenderStorageNote() {
    const note = safetyElement('safety-contacts-storage');
    if (!note) return;
    note.textContent = safetyAccountReady()
        ? 'Se guardan en tu cuenta: al iniciar sesión en otro móvil los tendrás disponibles.'
        : 'Sin sesión se guardan solo en este móvil. Inicia sesión para guardarlos en tu cuenta.';
}

function safetyPersistSettings() {
    safetySaveJson(SAFETY_SETTINGS_KEY, safetySettings);
}

function safetyGroupTrackingEnabled() {
    return safetySettings.groupLiveTracking !== false;
}

async function safetySetGroupTracking(enabled) {
    let failed = false;
    safetySettings.groupLiveTracking = enabled === true;
    try {
        safetyPersistSettings();
        if (!safetySettings.groupLiveTracking) {
            if (typeof removeMyLiveLocation === 'function') await removeMyLiveLocation();
        } else if (typeof isRecording !== 'undefined' && isRecording
            && typeof isPaused !== 'undefined' && !isPaused
            && typeof publishMyLocation === 'function') {
            await publishMyLocation(true);
        }
        safetyUpdateGroupStatus();
    } catch (error) {
        console.error('No se pudo actualizar el seguimiento en directo:', error);
        safetySettings.groupLiveTracking = !enabled;
        const toggle = safetyElement('safety-group-sharing');
        if (toggle) toggle.checked = safetySettings.groupLiveTracking;
        failed = true;
    }
    safetyRender();
    // El aviso de error se muestra después del estado normal para que no quede tapado.
    if (failed) {
        const groupStatus = safetyElement('safety-group-status');
        if (groupStatus) groupStatus.textContent = 'No se pudo cambiar el seguimiento en directo. Inténtalo de nuevo.';
    }
}

function safetyUpdateGroupStatus() {
    const status = safetyElement('safety-group-status');
    if (!status) return;
    const joined = typeof groupJoined !== 'undefined' && groupJoined
        && typeof Cloud !== 'undefined' && typeof Cloud.loggedIn === 'function' && Cloud.loggedIn();
    if (!joined) {
        status.textContent = 'Para compartir la ubicación en directo, inicia sesión y únete a un grupo.';
    } else if (!safetyGroupTrackingEnabled()) {
        status.textContent = 'Seguimiento desactivado. Tu posición no se publicará en el grupo.';
    } else if (typeof isRecording !== 'undefined' && isRecording
        && typeof isPaused !== 'undefined' && !isPaused) {
        status.textContent = 'Activado: se compartirá con tu grupo si el GPS tiene una posición reciente y precisa.';
    } else {
        status.textContent = 'Activado: se compartirá con tu grupo al grabar una ruta.';
    }
}

function safetyRenderContacts() {
    const list = safetyElement('safety-contact-list');
    const select = safetyElement('safety-sos-contact');
    if (!list || !select) return;
    const form = safetyElement('safety-contact-form');
    const addButton = safetyElement('safety-add-contact');
    const formOpen = safetyContactFormOpen || safetyContacts.length === 0;
    if (form) form.hidden = !formOpen;
    if (addButton) {
        addButton.hidden = formOpen || safetyContacts.length >= SAFETY_MAX_CONTACTS;
        addButton.setAttribute('aria-expanded', String(formOpen));
    }
    list.replaceChildren();
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = safetyContacts.length ? 'Selecciona un contacto' : 'Añade un contacto primero';
    select.append(placeholder);
    safetyContacts.forEach((contact, index) => {
        const item = document.createElement('li');
        item.className = 'safety-contact-item';
        const label = document.createElement('span');
        label.textContent = `${contact.name} · ${contact.phone}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.contactIndex = String(index);
        remove.textContent = 'Eliminar';
        remove.setAttribute('aria-label', `Eliminar contacto ${contact.name}`);
        item.append(label, remove);
        list.append(item);

        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = contact.name;
        select.append(option);
    });
    select.value = safetyContacts.length ? '0' : '';
    const callLink = safetyElement('safety-call-contact');
    const defaultContact = safetyContacts[0];
    if (callLink) {
        callLink.hidden = !defaultContact;
        if (defaultContact) {
            callLink.href = `tel:${defaultContact.phone}`;
            callLink.textContent = `Llamar al contacto predeterminado: ${defaultContact.name}`;
            callLink.setAttribute('aria-label', `Llamar al contacto predeterminado ${defaultContact.name}, ${defaultContact.phone}`);
        } else {
            callLink.removeAttribute('href');
            callLink.textContent = 'Llamar al contacto predeterminado';
            callLink.removeAttribute('aria-label');
        }
    }
    const sendButton = safetyElement('safety-send-sos');
    if (sendButton) sendButton.disabled = safetyContacts.length === 0;
}

function safetyGetLocation() {
    const lat = typeof lastLat !== 'undefined' ? lastLat : null;
    const lon = typeof lastLon !== 'undefined' ? lastLon : null;
    return {
        lat,
        lon,
        updatedAt: typeof lastPositionAt !== 'undefined' ? lastPositionAt : null,
        accuracy: typeof lastAccuracy !== 'undefined' ? lastAccuracy : null
    };
}

function safetyRenderLocation() {
    const label = safetyElement('safety-last-location');
    const link = safetyElement('safety-location-link');
    if (!label || !link) return;
    const location = safetyGetLocation();
    if (Number.isFinite(location.lat) && Number.isFinite(location.lon)
        && location.lat >= -90 && location.lat <= 90
        && location.lon >= -180 && location.lon <= 180) {
        const updated = Number.isFinite(location.updatedAt) && location.updatedAt > 0
            ? new Date(location.updatedAt).toLocaleString('es-ES')
            : 'hora desconocida';
        const accuracy = Number.isFinite(location.accuracy) && location.accuracy > 0
            ? ` · precisión ±${Math.round(location.accuracy)} m`
            : '';
        label.textContent = `Última ubicación conocida: ${location.lat.toFixed(5)}, ${location.lon.toFixed(5)} · ${updated}${accuracy}.`;
        link.href = `https://maps.google.com/?q=${location.lat},${location.lon}`;
        link.hidden = false;
    } else {
        label.textContent = 'Última ubicación conocida: no disponible.';
        link.removeAttribute('href');
        link.hidden = true;
    }
}

function safetyRender() {
    if (typeof document === 'undefined') return;
    safetyRenderStorageNote();
    safetyUpdateGroupStatus();
    safetyRenderLocation();
}

// La grabación avisa al empezar y terminar; solo se refresca el estado visible.
async function safetyOnRecordingStarted() {
    safetyRender();
}

async function safetyOnRecordingStopped() {
    safetyRender();
}

function safetyOpenWorkspace() {
    toolsOpenWorkspace('safety-workspace');
    safetyRender();
}

function safetyCloseWorkspace() {
    toolsCloseWorkspaces();
    document.querySelector('.tools-hub')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function safetySendSOS() {
    const select = safetyElement('safety-sos-contact');
    const selectedIndex = select && select.value !== '' ? Number(select.value) : -1;
    const contact = Number.isInteger(selectedIndex) ? safetyContacts[selectedIndex] : null;
    if (!contact) {
        safetyShowStatus('Añade y selecciona un contacto de emergencia antes de preparar el SOS.', 'error');
        return;
    }
    try {
        const message = safetyBuildSOSMessage(safetyGetLocation());
        const opened = window.open(safetyBuildWhatsAppUrl(contact, message), '_blank');
        if (opened) opened.opener = null;
        safetyShowStatus(
            opened
                ? 'WhatsApp se ha abierto. Revisa la ubicación y pulsa Enviar; la aplicación no envía el mensaje automáticamente.'
                : 'Se solicitó abrir WhatsApp, pero el navegador no confirmó la apertura. Si no se abrió, comprueba las ventanas emergentes o si WhatsApp está instalado.',
            opened ? 'success' : 'error'
        );
    } catch (error) {
        console.error('No se pudo preparar el mensaje SOS:', error);
        safetyShowStatus(`No se pudo abrir el mensaje SOS: ${error.message}`, 'error');
    }
}

function safetyBindUI() {
    const groupToggle = safetyElement('safety-group-sharing');
    if (groupToggle) {
        groupToggle.checked = safetyGroupTrackingEnabled();
        groupToggle.addEventListener('change', () => safetySetGroupTracking(groupToggle.checked));
    }

    safetyElement('safety-add-contact')?.addEventListener('click', () => {
        safetyContactFormOpen = true;
        safetyRenderContacts();
        safetyElement('safety-contact-name')?.focus();
    });

    safetyElement('safety-contact-form')?.addEventListener('submit', event => {
        event.preventDefault();
        const nameInput = safetyElement('safety-contact-name');
        const phoneInput = safetyElement('safety-contact-phone');
        const name = nameInput.value.trim();
        const phone = safetyNormalizePhone(phoneInput.value);
        if (!name || !phone) {
            safetyShowStatus('Escribe un nombre y un teléfono internacional válido (por ejemplo, +34600123456).', 'error');
            return;
        }
        if (safetyContacts.some(contact => contact.phone === phone)) {
            safetyShowStatus('Ese teléfono ya está guardado.', 'error');
            return;
        }
        if (safetyContacts.length >= SAFETY_MAX_CONTACTS) {
            safetyShowStatus(`Puedes guardar hasta ${SAFETY_MAX_CONTACTS} contactos.`, 'error');
            return;
        }
        safetyContacts.push({ name, phone });
        try {
            safetyPersistContacts();
            nameInput.value = '';
            phoneInput.value = '';
            safetyContactFormOpen = false;
            safetyRenderContacts();
            safetyShowStatus(safetyContactsSavedMessage('Contacto guardado'), 'success');
        } catch (error) {
            safetyContacts.pop();
            console.error('No se pudo guardar el contacto:', error);
            safetyShowStatus('No se pudo guardar el contacto en este dispositivo.', 'error');
        }
    });

    safetyElement('safety-contact-list')?.addEventListener('click', event => {
        const button = event.target.closest('[data-contact-index]');
        if (!button) return;
        const index = Number(button.dataset.contactIndex);
        if (!Number.isInteger(index) || index < 0 || index >= safetyContacts.length) return;
        const removed = safetyContacts.splice(index, 1)[0];
        try {
            safetyPersistContacts();
            safetyRenderContacts();
            safetyShowStatus(safetyContactsSavedMessage(`Contacto ${removed.name} eliminado`), 'success');
        } catch (error) {
            safetyContacts.splice(index, 0, removed);
            console.error('No se pudo eliminar el contacto:', error);
            safetyShowStatus('No se pudo actualizar la lista de contactos.', 'error');
        }
    });

    safetyElement('safety-back')?.addEventListener('click', safetyCloseWorkspace);
    safetyElement('safety-send-sos')?.addEventListener('click', safetySendSOS);

    safetyRenderContacts();
    safetyRender();
    window.addEventListener('load', safetyRender, { once: true });

    // Ubicación y estado del grupo cambian durante la grabación.
    window.setInterval(safetyRender, 5000);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { safetyNormalizePhone, safetyNormalizeContacts, safetyBuildWhatsAppUrl, safetyBuildSOSMessage };
}

if (typeof document !== 'undefined') {
    safetyLoadState();
    safetyBindUI();
}
