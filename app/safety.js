'use strict';

const SAFETY_CONTACTS_KEY = 'mtb_pro_safety_contacts';
const SAFETY_SETTINGS_KEY = 'mtb_pro_safety_settings';
const SAFETY_SESSION_KEY = 'mtb_pro_safety_session';
const SAFETY_NOTIFICATION_ID = 2480116;
const SAFETY_MAX_CONTACTS = 5;

function safetyNormalizePhone(value) {
    const compact = String(value || '').trim().replace(/[\s()-]/g, '');
    if (!/^\+?[1-9]\d{6,14}$/.test(compact)) return null;
    return compact.startsWith('+') ? compact : `+${compact}`;
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
let safetySettings = { durationMinutes: 180, graceMinutes: 15, groupLiveTracking: true, armed: false };
let safetySession = null;
let safetyOverdueToastShown = false;

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

function safetyLoadState() {
    let loadWarning = '';
    try {
        const contactsValue = localStorage.getItem(SAFETY_CONTACTS_KEY);
        const settingsValue = localStorage.getItem(SAFETY_SETTINGS_KEY);
        const sessionValue = localStorage.getItem(SAFETY_SESSION_KEY);
        if (contactsValue) {
            const parsedContacts = JSON.parse(contactsValue);
            if (!Array.isArray(parsedContacts)) throw new Error('La lista de contactos guardada no es válida.');
            safetyContacts = parsedContacts.slice(0, SAFETY_MAX_CONTACTS).filter(contact =>
                contact && typeof contact.name === 'string' && safetyNormalizePhone(contact.phone)
            ).map(contact => ({
                name: contact.name.trim().slice(0, 40),
                phone: safetyNormalizePhone(contact.phone)
            })).filter(contact => contact.name);
            if (safetyContacts.length !== parsedContacts.length) {
                loadWarning = 'Se omitieron contactos guardados que no tenían datos válidos o superaban el límite permitido.';
            }
        }
        if (settingsValue) {
            const parsedSettings = JSON.parse(settingsValue);
            if (!parsedSettings || typeof parsedSettings !== 'object') throw new Error('La configuración de seguridad guardada no es válida.');
            const durationMinutes = Number.isInteger(parsedSettings.durationMinutes)
                && parsedSettings.durationMinutes >= 15 && parsedSettings.durationMinutes <= 720
                ? parsedSettings.durationMinutes
                : 180;
            const graceMinutes = Number.isInteger(parsedSettings.graceMinutes)
                && parsedSettings.graceMinutes >= 5 && parsedSettings.graceMinutes <= 120
                ? parsedSettings.graceMinutes
                : 15;
            if (durationMinutes !== parsedSettings.durationMinutes || graceMinutes !== parsedSettings.graceMinutes) {
                loadWarning = 'Se restauraron valores seguros para una duración o margen guardado no válido.';
            }
            safetySettings = {
                durationMinutes,
                graceMinutes,
                groupLiveTracking: typeof parsedSettings.groupLiveTracking === 'boolean' ? parsedSettings.groupLiveTracking : true,
                armed: parsedSettings.armed === true
            };
        }
        if (sessionValue) {
            const parsedSession = JSON.parse(sessionValue);
            if (parsedSession && Number.isFinite(parsedSession.startedAt)
                && Number.isFinite(parsedSession.plannedEndAt) && Number.isFinite(parsedSession.alertAt)) {
                safetySession = parsedSession;
            } else {
                throw new Error('La sesión de seguridad guardada no es válida.');
            }
        }
        if (loadWarning) safetyShowStatus(loadWarning, 'error');
    } catch (error) {
        console.error('No se pudo cargar la configuración de seguridad:', error);
        safetyShowStatus('No se pudieron leer todos los datos guardados. Revisa el almacenamiento local de esta aplicación.', 'error');
    }
}

function safetyPersistSettings() {
    safetySaveJson(SAFETY_SETTINGS_KEY, safetySettings);
}

function safetyGroupTrackingEnabled() {
    return safetySettings.groupLiveTracking !== false;
}

async function safetySetGroupTracking(enabled) {
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
        safetyShowStatus(
            safetySettings.groupLiveTracking
                ? 'Seguimiento en directo activado para las grabaciones en grupo.'
                : 'Seguimiento en directo desactivado; se intentará retirar la última posición publicada.',
            'success'
        );
    } catch (error) {
        console.error('No se pudo actualizar el seguimiento en directo:', error);
        safetySettings.groupLiveTracking = !enabled;
        const toggle = safetyElement('safety-group-sharing');
        if (toggle) toggle.checked = safetySettings.groupLiveTracking;
        safetyShowStatus('No se pudo cambiar el seguimiento en directo. Inténtalo de nuevo.', 'error');
    }
    safetyRender();
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

function safetyFormatRemaining(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function safetyRender() {
    if (typeof document === 'undefined') return;
    const now = Date.now();
    const status = safetyElement('safety-session-status');
    const countdown = safetyElement('safety-countdown');
    const cancelButton = safetyElement('safety-cancel-alert');
    const endButton = safetyElement('safety-end-session');
    if (safetySession) {
        const remaining = safetySession.plannedEndAt - now;
        if (countdown) countdown.textContent = safetyFormatRemaining(remaining);
        if (status) {
            status.textContent = now >= safetySession.alertAt
                ? 'Se superó la duración y el margen previstos. El aviso es local: nadie ha sido contactado.'
                : now >= safetySession.plannedEndAt
                    ? 'Se superó la duración prevista. Puedes cancelar el aviso si estás bien.'
                    : `Protección activa. Hora prevista de regreso: ${new Date(safetySession.plannedEndAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`;
        }
        if (cancelButton) cancelButton.hidden = now < safetySession.plannedEndAt;
        if (endButton) endButton.hidden = false;
        if (now >= safetySession.alertAt && !safetyOverdueToastShown) {
            safetyOverdueToastShown = true;
            if (typeof toast === 'function') toast('Aviso de seguridad: se superó el tiempo previsto. Revisa que todo esté bien.', 6000);
        }
    } else {
        if (countdown) countdown.textContent = '--:--:--';
        if (status) status.textContent = safetySettings.armed
            ? 'Preparada: se activará al comenzar una grabación.'
            : 'Sin protección activa.';
        if (cancelButton) cancelButton.hidden = true;
        if (endButton) endButton.hidden = true;
    }
    safetyUpdateGroupStatus();
    safetyRenderLocation();
}

function safetyNotificationsPlugin() {
    return typeof window !== 'undefined'
        ? window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications
        : null;
}

async function safetyCancelNotification() {
    const plugin = safetyNotificationsPlugin();
    if (!plugin || typeof plugin.cancel !== 'function') return;
    await plugin.cancel({ notifications: [{ id: SAFETY_NOTIFICATION_ID }] });
}

async function safetyScheduleNotification(session) {
    const plugin = safetyNotificationsPlugin();
    if (!plugin || typeof plugin.schedule !== 'function') return false;
    let permissions = typeof plugin.checkPermissions === 'function' ? await plugin.checkPermissions() : { display: 'granted' };
    if (permissions.display !== 'granted' && typeof plugin.requestPermissions === 'function') {
        permissions = await plugin.requestPermissions();
    }
    if (permissions.display !== 'granted') throw new Error('No se concedió permiso para las notificaciones locales.');
    await safetyCancelNotification();
    await plugin.schedule({
        notifications: [{
            id: SAFETY_NOTIFICATION_ID,
            title: 'SENDA MTB · aviso de ruta',
            body: 'Se ha superado la duración prevista más el margen. Abre la aplicación para revisar la salida.',
            schedule: { at: new Date(session.alertAt) },
            extra: { type: 'safety-delay' }
        }]
    });
    return true;
}

async function safetyStartSession() {
    if (typeof isRecording === 'undefined' || !isRecording) {
        safetySettings.armed = true;
        safetyPersistSettings();
        safetyShowStatus('Protección preparada; se activará al comenzar una grabación.', 'success');
        safetyRender();
        return;
    }
    if (safetySession) {
        safetyShowStatus('Ya hay una protección activa. Finalízala antes de iniciar otra.', 'error');
        return;
    }
    if (!Number.isInteger(safetySettings.durationMinutes) || safetySettings.durationMinutes < 15 || safetySettings.durationMinutes > 720
        || !Number.isInteger(safetySettings.graceMinutes) || safetySettings.graceMinutes < 5 || safetySettings.graceMinutes > 120) {
        safetyShowStatus('La duración o el margen guardados no son válidos. Revísalos antes de activar la protección.', 'error');
        return;
    }
    const startedAt = Date.now();
    const plannedEndAt = startedAt + safetySettings.durationMinutes * 60 * 1000;
    safetySession = {
        startedAt,
        plannedEndAt,
        alertAt: plannedEndAt + safetySettings.graceMinutes * 60 * 1000
    };
    safetySettings.armed = false;
    safetyOverdueToastShown = false;
    try {
        safetyPersistSettings();
        safetySaveJson(SAFETY_SESSION_KEY, safetySession);
        const scheduled = await safetyScheduleNotification(safetySession);
        safetyShowStatus(
            scheduled
                ? 'Protección activa y aviso local programado. La alerta no contacta a nadie.'
                : 'Protección activa en la aplicación. No hay notificaciones locales disponibles en este dispositivo.',
            scheduled ? 'success' : 'error'
        );
    } catch (error) {
        console.error('No se pudo programar el aviso de seguridad:', error);
        safetyShowStatus(`Protección activa, pero no se pudo programar el aviso local: ${error.message}`, 'error');
    }
    safetyRender();
}

async function safetyOnRecordingStarted() {
    if (safetySettings.armed && !safetySession) await safetyStartSession();
    else safetyRender();
}

async function safetyEndSession(message) {
    safetySession = null;
    safetyOverdueToastShown = false;
    let cleanupError = null;
    try {
        localStorage.removeItem(SAFETY_SESSION_KEY);
    } catch (error) {
        cleanupError = error;
        console.error('No se pudo borrar la sesión de seguridad guardada:', error);
    }
    try {
        await safetyCancelNotification();
    } catch (error) {
        cleanupError = cleanupError || error;
        console.error('No se pudo cancelar el aviso de seguridad:', error);
    }
    safetyShowStatus(
        cleanupError
            ? `La protección se ha detenido, pero no se pudo completar toda la limpieza: ${cleanupError.message}`
            : message,
        cleanupError ? 'error' : 'success'
    );
    safetyRender();
}

async function safetyOnRecordingStopped() {
    if (safetySession) await safetyEndSession('Protección finalizada al terminar la grabación.');
    else safetyRender();
}

function safetyOpenWorkspace() {
    const workspace = safetyElement('safety-workspace');
    const hub = document.querySelector('.tools-hub');
    const aiPreview = document.querySelector('.ai-preview');
    if (!workspace || !hub || !aiPreview) return;
    hub.hidden = true;
    aiPreview.hidden = true;
    workspace.hidden = false;
    safetyRender();
    workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function safetyCloseWorkspace() {
    const workspace = safetyElement('safety-workspace');
    const hub = document.querySelector('.tools-hub');
    const aiPreview = document.querySelector('.ai-preview');
    if (!workspace || !hub || !aiPreview) return;
    workspace.hidden = true;
    hub.hidden = false;
    aiPreview.hidden = false;
    hub.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

function safetyValidateSettings() {
    const durationMinutes = Number(safetyElement('safety-duration').value);
    const graceMinutes = Number(safetyElement('safety-grace').value);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 720) {
        throw new Error('La duración debe estar entre 15 y 720 minutos.');
    }
    if (!Number.isInteger(graceMinutes) || graceMinutes < 5 || graceMinutes > 120) {
        throw new Error('El margen de aviso debe estar entre 5 y 120 minutos.');
    }
    safetySettings.durationMinutes = durationMinutes;
    safetySettings.graceMinutes = graceMinutes;
}

function safetyBindUI() {
    const duration = safetyElement('safety-duration');
    const grace = safetyElement('safety-grace');
    const groupToggle = safetyElement('safety-group-sharing');
    if (duration) duration.value = String(safetySettings.durationMinutes);
    if (grace) grace.value = String(safetySettings.graceMinutes);
    if (groupToggle) {
        groupToggle.checked = safetyGroupTrackingEnabled();
        groupToggle.addEventListener('change', () => safetySetGroupTracking(groupToggle.checked));
    }

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
            safetySaveJson(SAFETY_CONTACTS_KEY, safetyContacts);
            nameInput.value = '';
            phoneInput.value = '';
            safetyRenderContacts();
            safetyShowStatus('Contacto guardado solo en este dispositivo.', 'success');
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
            safetySaveJson(SAFETY_CONTACTS_KEY, safetyContacts);
            safetyRenderContacts();
            safetyShowStatus(`Contacto ${removed.name} eliminado de este dispositivo.`, 'success');
        } catch (error) {
            safetyContacts.splice(index, 0, removed);
            console.error('No se pudo eliminar el contacto:', error);
            safetyShowStatus('No se pudo actualizar la lista de contactos.', 'error');
        }
    });

    safetyElement('safety-prepare')?.addEventListener('click', async () => {
        try {
            safetyValidateSettings();
            if (safetySession) {
                safetyShowStatus('Ya hay una protección activa. Finalízala antes de preparar otra.', 'error');
                return;
            }
            safetyPersistSettings();
            if (typeof isRecording !== 'undefined' && isRecording) await safetyStartSession();
            else {
                safetySettings.armed = true;
                safetyPersistSettings();
                safetyShowStatus('Preparada: la protección se activará al comenzar una grabación.', 'success');
                safetyRender();
            }
        } catch (error) {
            console.error('No se pudo preparar la salida:', error);
            safetyShowStatus(error.message || 'No se pudo guardar la configuración de seguridad.', 'error');
        }
    });

    safetyElement('safety-back')?.addEventListener('click', safetyCloseWorkspace);
    safetyElement('safety-send-sos')?.addEventListener('click', safetySendSOS);
    safetyElement('safety-cancel-alert')?.addEventListener('click', () => safetyEndSession('Aviso cancelado: has indicado que estás bien.'));
    safetyElement('safety-end-session')?.addEventListener('click', () => safetyEndSession('Protección finalizada.'));

    safetyRenderContacts();
    safetyRender();
    window.addEventListener('load', safetyRender, { once: true });

    const plugin = safetyNotificationsPlugin();
    if (plugin && typeof plugin.addListener === 'function') {
        try {
            Promise.resolve(plugin.addListener('localNotificationActionPerformed', event => {
                if (event && event.notification && event.notification.id === SAFETY_NOTIFICATION_ID) {
                    if (typeof goToPage === 'function') goToPage(7);
                    safetyOpenWorkspace();
                }
            })).catch(error => {
                console.error('No se pudo escuchar la apertura de avisos de seguridad:', error);
            });
        } catch (error) {
            console.error('No se pudo escuchar la apertura de avisos de seguridad:', error);
            safetyShowStatus('No se pudo activar la acción al tocar la notificación de seguridad.', 'error');
        }
    }
    window.setInterval(safetyRender, 1000);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { safetyNormalizePhone, safetyBuildWhatsAppUrl, safetyBuildSOSMessage };
}

if (typeof document !== 'undefined') {
    safetyLoadState();
    safetyBindUI();
}
