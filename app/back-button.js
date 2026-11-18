'use strict';

function handleAppBack() {
    const dimOverlay = $('screen-dim-overlay');
    if (dimOverlay && !dimOverlay.hidden) {
        screenWakeNow();
        return true;
    }

    const modalDialog = $('modal');
    if (modalDialog && modalDialog.classList.contains('show')) {
        $('modal-cancel').click();
        return true;
    }

    if (currentPage === 7 && typeof toolsHandleBackButton === 'function' && toolsHandleBackButton()) return true;
    if (typeof handleCommunityBackButton === 'function' && handleCommunityBackButton()) return true;
    if (currentPage === 3 && routesTab !== 'done') {
        setRoutesTab('done');
        return true;
    }
    if (currentPage === 3 && routesShowAll) {
        routesShowAll = false;
        renderSavedRoutes();
        return true;
    }
    return goBackPage();
}

let exitPromptOpen = false;

async function requestAppExit() {
    if (exitPromptOpen) return;
    exitPromptOpen = true;
    const recording = isRecording;
    try {
        const confirmed = await modal({
            eyebrow: recording ? '● GRABACIÓN ACTIVA' : 'senda-mtb  •  CENTRO DE ACTIVIDAD',
            title: recording ? '¿Seguro que quieres salir?' : '¿Quieres salir de senda-mtb?',
            message: recording
                ? 'La grabación sigue en curso. Si sales, podría interrumpirse y la ruta quedará sin finalizar.'
                : 'Puedes volver cuando quieras.',
            ok: recording ? 'Salir de todos modos' : 'Salir',
            cancel: recording ? 'Seguir grabando' : 'Seguir aquí',
            variant: 'exit',
            state: recording ? 'recording' : 'idle'
        });
        if (!confirmed) return;
        if (!window.MTBNativeApp || typeof window.MTBNativeApp.exitApp !== 'function') {
            throw new Error('No está disponible el cierre de la aplicación.');
        }
        await window.MTBNativeApp.exitApp();
    } catch (error) {
        console.warn('No se pudo cerrar la aplicación:', error);
        toast('No se pudo cerrar la aplicación.', 4000);
    } finally {
        exitPromptOpen = false;
    }
}

window.mtbRequestAppExit = requestAppExit;

function initNativeBackButton() {
    const capacitor = window.Capacitor;
    if (!capacitor || typeof capacitor.isNativePlatform !== 'function'
        || !capacitor.isNativePlatform() || !window.MTBNativeApp) return;

    window.MTBNativeApp.addBackButtonListener(async event => {
        if (handleAppBack()) return;
        if (event.canGoBack) {
            window.history.back();
            return;
        }
        await requestAppExit();
    }).catch(error => {
        console.warn('No se pudo activar el botón de retroceso de Android:', error);
    });
}

initNativeBackButton();
