'use strict';

function appBackElementIsCurrent(element) {
    if (!element || typeof element.closest !== 'function') return true;
    const page = element.closest('.page');
    return !page || typeof swiper === 'undefined' || swiper.children[currentPage] === page;
}

function appBackElementIsVisible(element) {
    return Boolean(element && !element.hidden
        && typeof element.getClientRects === 'function' && element.getClientRects().length
        && appBackElementIsCurrent(element));
}

function handleNativeDialogBackButton() {
    const dialogs = [...document.querySelectorAll('dialog[open]')].reverse();
    const dialog = dialogs.find(appBackElementIsVisible);
    if (!dialog) return false;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    return true;
}

function handleExpandedControlBackButton() {
    const controls = [...document.querySelectorAll('[aria-expanded="true"][aria-controls]')].reverse();
    for (const control of controls) {
        if (!appBackElementIsVisible(control)) continue;
        const targetId = String(control.getAttribute('aria-controls') || '').trim().split(/\s+/)[0];
        const target = targetId ? document.getElementById(targetId) : null;
        if (!appBackElementIsVisible(target)) continue;
        target.hidden = true;
        control.setAttribute('aria-expanded', 'false');
        return true;
    }
    return false;
}

function handleDisclosureBackButton() {
    const disclosures = [...document.querySelectorAll('details[open]')].reverse();
    const disclosure = disclosures.find(appBackElementIsVisible);
    if (!disclosure) return false;
    disclosure.open = false;
    return true;
}

function handleMapPopupBackButton() {
    if (typeof map === 'undefined' || !map || typeof map.getContainer !== 'function') return false;
    const container = map.getContainer();
    if (!appBackElementIsCurrent(container) || !container.querySelector('.leaflet-popup')) return false;
    map.closePopup();
    return true;
}

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

    if (handleNativeDialogBackButton()) return true;
    if (typeof handleCommunityBackButton === 'function' && handleCommunityBackButton()) return true;
    const bigMetric = $('big-metric');
    if (bigMetric && bigMetric.classList.contains('show')
        && typeof collapseMetric === 'function') {
        collapseMetric();
        return true;
    }
    if (handleMapPopupBackButton()) return true;
    if (typeof safetyHandleBackButton === 'function' && safetyHandleBackButton()) return true;
    if (handleExpandedControlBackButton()) return true;
    if (handleDisclosureBackButton()) return true;
    if (currentPage === 7 && typeof toolsHandleBackButton === 'function' && toolsHandleBackButton()) return true;
    if (currentPage === 3 && routesTab !== 'done') {
        setRoutesTab('done');
        return true;
    }
    if (currentPage === 3 && routesShowAll) {
        routesShowAll = false;
        renderSavedRoutes();
        return true;
    }
    if (currentPage === 2) {
        const activeCommunityTab = document.querySelector('[data-community-section][aria-selected="true"]');
        if (activeCommunityTab && activeCommunityTab.dataset.communitySection !== 'ranking') {
            communitySetSection('ranking');
            return true;
        }
    }
    if (currentPage === 1 && typeof activeStatsSlide === 'number' && activeStatsSlide > 0) {
        setStatsSlide(activeStatsSlide - 1);
        return true;
    }
    const previousPage = previousMainMenuPage(currentPage);
    if (previousPage !== null) {
        goToPage(previousPage);
        return true;
    }
    return false;
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
