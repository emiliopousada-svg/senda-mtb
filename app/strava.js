'use strict';

const STRAVA_UPLOAD_POLL_INTERVAL_MS = 2000;
const STRAVA_UPLOAD_POLL_ATTEMPTS = 15;
let stravaStatusRequest = null;
let stravaUploadBusy = false;

function stravaSetStatus(message, isError = false) {
    const node = document.getElementById('strava-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', isError);
}

function stravaSetUploadStatus(message, isError = false) {
    const node = document.getElementById('strava-upload-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', isError);
}

function stravaLocalRoutes() {
    return (Array.isArray(savedRoutes) ? savedRoutes : [])
        .filter(route => route?.kind === 'recorded' && Array.isArray(route.points) && route.points.length >= 2)
        .sort((a, b) => Number(b.id) - Number(a.id));
}

function stravaRenderRouteOptions() {
    const select = document.getElementById('strava-activity');
    if (!select) return;
    const previous = select.value;
    const routes = stravaLocalRoutes();
    select.replaceChildren();
    if (!routes.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No hay salidas grabadas en este dispositivo';
        select.append(option);
        return;
    }
    routes.forEach(route => {
        const option = document.createElement('option');
        option.value = String(route.id);
        const date = route.startedAt ? new Date(route.startedAt).toLocaleDateString('es-ES') : 'Sin fecha';
        const distance = Number(route.distanceKm) > 0 ? `${Number(route.distanceKm).toFixed(1)} km` : '';
        option.textContent = [route.name || 'Salida MTB', date, distance].filter(Boolean).join(' · ');
        select.append(option);
    });
    if (routes.some(route => String(route.id) === previous)) select.value = previous;
}

async function stravaRefreshStatus() {
    if (!Cloud.loggedIn()) {
        stravaSetStatus('Inicia sesión en senda-mtb para conectar Strava.');
        document.getElementById('strava-connect').hidden = true;
        document.getElementById('strava-disconnect').hidden = true;
        document.getElementById('strava-upload-panel').hidden = true;
        return;
    }
    if (stravaStatusRequest) return stravaStatusRequest;
    stravaStatusRequest = (async () => {
        try {
            const result = await cloudApi('/api/mtb/strava/status');
            const connected = result.connected === true;
            const connectButton = document.getElementById('strava-connect');
            connectButton.hidden = false;
            connectButton.textContent = connected ? 'Volver a autorizar' : 'Conectar con Strava';
            document.getElementById('strava-disconnect').hidden = !connected;
            document.getElementById('strava-upload-panel').hidden = !connected;
            stravaSetStatus(connected
                ? `Conectado${result.athleteName ? ` como ${result.athleteName}` : ' con Strava'}.`
                : 'Tu cuenta de Strava no está conectada.');
            if (connected) stravaRenderRouteOptions();
            return connected;
        } catch (error) {
            stravaSetStatus(error.message || 'No se pudo consultar Strava.', true);
            return false;
        } finally {
            stravaStatusRequest = null;
        }
    })();
    return stravaStatusRequest;
}

document.getElementById('strava-refresh')?.addEventListener('click', stravaRefreshStatus);
document.getElementById('strava-connect')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    stravaSetStatus('Abriendo la autorización segura de Strava…');
    try {
        const result = await cloudApi('/api/mtb/strava/connect', 'POST', {});
        const authorizationUrl = new URL(result.url);
        if (authorizationUrl.origin !== 'https://www.strava.com' || authorizationUrl.pathname !== '/oauth/authorize') {
            throw new Error('El servidor devolvió una dirección de autorización no válida.');
        }
        const cap = window.Capacitor;
        if (cap?.isNativePlatform?.() && window.SendaStravaBrowser?.open) {
            await window.SendaStravaBrowser.open({ url: authorizationUrl.href });
        } else {
            window.open(authorizationUrl.href, '_blank', 'noopener,noreferrer');
        }
        stravaSetStatus('Autoriza senda-mtb en Strava y vuelve aquí. Después pulsa «Actualizar estado».');
    } catch (error) {
        stravaSetStatus(error.message || 'No se pudo iniciar la conexión con Strava.', true);
    } finally {
        button.disabled = false;
    }
});

document.getElementById('strava-disconnect')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        await cloudApi('/api/mtb/strava/disconnect', 'POST', {});
        document.getElementById('strava-upload-panel').hidden = true;
        button.hidden = true;
        document.getElementById('strava-connect').hidden = false;
        document.getElementById('strava-connect').textContent = 'Conectar con Strava';
        stravaSetStatus('Cuenta de Strava desconectada.');
    } catch (error) {
        stravaSetStatus(error.message || 'No se pudo desconectar Strava.', true);
    } finally {
        button.disabled = false;
    }
});

document.getElementById('strava-upload')?.addEventListener('click', async event => {
    if (stravaUploadBusy) return;
    const routeId = document.getElementById('strava-activity').value;
    const route = stravaLocalRoutes().find(item => String(item.id) === routeId);
    if (!route) {
        stravaSetUploadStatus('Selecciona una salida grabada para subir.', true);
        return;
    }
    if (!route.points.every(point => Number.isFinite(Number(point[3])))) {
        stravaSetUploadStatus('Esta salida no conserva marcas de tiempo en todos sus puntos y Strava no la puede procesar como actividad.', true);
        return;
    }
    const button = event.currentTarget;
    stravaUploadBusy = true;
    button.disabled = true;
    stravaSetUploadStatus('Subiendo el GPX a Strava…');
    try {
        const filename = `senda-mtb-${routeId}.gpx`;
        const file = new File([routeToGpx(route)], filename, { type: 'application/gpx+xml' });
        const form = new FormData();
        form.append('file', file);
        form.append('routeId', routeId);
        form.append('name', String(route.name || 'Salida MTB').slice(0, 120));
        form.append('visibility', document.getElementById('strava-visibility').value);
        const upload = await cloudApi('/api/mtb/strava/upload', 'POST', form, { timeoutMs: 60000 });
        if (!upload.uploadId) throw new Error('Strava no devolvió el identificador de subida.');

        for (let attempt = 0; attempt < STRAVA_UPLOAD_POLL_ATTEMPTS; attempt++) {
            await new Promise(resolve => setTimeout(resolve, STRAVA_UPLOAD_POLL_INTERVAL_MS));
            const status = await cloudApi(`/api/mtb/strava/upload/${encodeURIComponent(upload.uploadId)}`);
            if (status.activityId) {
                stravaSetUploadStatus('✅ Actividad publicada correctamente en Strava.');
                return;
            }
            if (status.error) throw new Error(status.error);
        }
        stravaSetUploadStatus('Strava sigue procesando la salida. Comprueba tu perfil de Strava en un momento.');
    } catch (error) {
        stravaSetUploadStatus(error.message || 'No se pudo subir la salida a Strava.', true);
    } finally {
        stravaUploadBusy = false;
        button.disabled = false;
    }
});

document.getElementById('social-workspace')?.addEventListener('toggle', () => {
    if (!document.getElementById('social-workspace').hidden) stravaRefreshStatus();
});
document.querySelector('.tools-grid')?.addEventListener('click', event => {
    if (event.target.closest('[data-tool="social"]')) {
        stravaRefreshStatus();
        stravaRenderRouteOptions();
    }
});
