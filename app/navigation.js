'use strict';

//  NAVEGACIÓN ENTRE PÁGINAS
// ============================================================
let currentPage = 5;
const pageHistory = [currentPage];
const swiper = $('swiper');
const navBtns = document.querySelectorAll('.nav-btn');
const carouselPageOrder = [5, 3, 0, 2, 1, 4, 6, 7];
const mainMenuPageOrder = Array.from(navBtns, button => Number(button.dataset.page));

document.querySelector('.brand-lockup')?.addEventListener('click', event => {
    event.preventDefault();
    goToPage(5);
});

function goToAdjacentPage(direction) {
    const position = carouselPageOrder.indexOf(currentPage);
    const nextPage = carouselPageOrder[position + direction];
    if (nextPage !== undefined) goToPage(nextPage);
}

function setSwiperPosition(index, immediate = false) {
    const targetPage = swiper.children[index];
    if (!targetPage) {
        console.error(`No existe la página ${index} dentro del carrusel.`);
        swiper.style.transform = 'translate3d(0,0,0)';
        return;
    }

    const pageOffset = targetPage.getBoundingClientRect().left - swiper.getBoundingClientRect().left;
    if (immediate) swiper.style.transition = 'none';
    swiper.style.transform = `translate3d(-${pageOffset}px,0,0)`;
    if (immediate) requestAnimationFrame(() => { swiper.style.transition = ''; });
}

document.addEventListener('DOMContentLoaded', () => {
    document.body.dataset.currentPage = String(currentPage);
    setSwiperPosition(currentPage, true);
    requestAnimationFrame(() => setSwiperPosition(currentPage, true));
    dashboardUpdateNav?.(currentPage);
});
setSwiperPosition(currentPage, true);
requestAnimationFrame(() => setSwiperPosition(currentPage, true));

function renderPage(index) {
    if (index !== 7 && typeof toolsCloseWorkspaces === 'function') toolsCloseWorkspaces();
    currentPage = index;
    setSwiperPosition(index);
    const navPage = index === 6 ? 0 : index;
    navBtns.forEach(btn => btn.classList.toggle('active', Number(btn.dataset.page) === navPage));
    document.body.dataset.currentPage = String(index);
    if (typeof cockpitUpdateOledSaver === 'function') cockpitUpdateOledSaver();
    if (typeof screenScheduleDim === 'function') screenScheduleDim();
    if (typeof dashboardUpdateNav === 'function') dashboardUpdateNav(index);
    if (index === 6 && typeof cockpitRender === 'function') cockpitRender();
    if (index === 1 && statsNeedsRefresh) requestAnimationFrame(refreshStats);
    if (index === 2 && typeof loadGroupRankings === 'function') loadGroupRankings();
    if (index === 0 && map) setTimeout(() => map.invalidateSize(), 150);
    if (index === 0 && typeof syncSharedPois === 'function') syncSharedPois();
    if ((index === 0 || index === 2) && typeof refreshFriends === 'function') refreshFriends();
    if (index === 5) {
        if (statsNeedsRefresh) requestAnimationFrame(refreshStats);
        if (typeof dashboardRender === 'function') dashboardRender();
    }
    if (index === 4) {
        if (typeof renderAccount === 'function') renderAccount();
        if (typeof profileRender === 'function') profileRender();
        if (typeof profileOpenEditorOnFirstVisit === 'function') profileOpenEditorOnFirstVisit();
    }
}

function goToPage(index) {
    if (!Number.isInteger(index) || index < 0 || index >= swiper.children.length) {
        console.warn('Se ignoró una navegación a una pantalla no válida:', index);
        return;
    }
    if (index !== currentPage) {
        pageHistory.push(currentPage);
        if (pageHistory.length > 20) pageHistory.shift();
    }
    renderPage(index);
}

function previousMainMenuPage(index) {
    if (index === 6 || index === 7) return mainMenuPageOrder[0];
    const position = mainMenuPageOrder.indexOf(index);
    return position > 0 ? mainMenuPageOrder[position - 1] : null;
}

function goBackPage() {
    if (pageHistory.length <= 1) return false;
    pageHistory.pop();
    renderPage(pageHistory[pageHistory.length - 1]);
    return true;
}

// Android delega aquí el botón Atrás para navegar por las páginas antes de salir.
// Devolver true significa que la pulsación quedó atendida por la aplicación.
window.mtbHandleHardwareBack = function () {
    if (typeof handleAppBack === 'function') {
        if (handleAppBack()) return true;
        if (typeof window.mtbRequestAppExit === 'function') {
            window.mtbRequestAppExit();
            return true;
        }
        return false;
    }
    const modalDialog = $('modal');
    if (modalDialog && modalDialog.classList && modalDialog.classList.contains('show')) {
        $('modal-cancel').click();
        return true;
    }
    const avatarDialog = $('home-avatar-dialog');
    if (avatarDialog && avatarDialog.open) {
        avatarDialog.close();
        return true;
    }
    if (currentPage === 7 && typeof toolsHandleBackButton === 'function' && toolsHandleBackButton()) {
        return true;
    }
    if (typeof handleCommunityBackButton === 'function' && handleCommunityBackButton()) return true;
    const previousPage = previousMainMenuPage(currentPage);
    if (previousPage !== null) {
        goToPage(previousPage);
        return true;
    }
    if (typeof window.mtbRequestAppExit === 'function') {
        window.mtbRequestAppExit();
        return true;
    }
    return false;
};

// Deslizamiento táctil horizontal (no actúa sobre el mapa, gráficas ni diálogos)
let touchStartX = 0, touchStartY = 0, swipeBlocked = false, statsSwipeStart = false;

document.addEventListener('touchstart', e => {
    const t = e.target;
    statsSwipeStart = !!(t.closest && t.closest('#stats-carousel'));
    swipeBlocked = statsSwipeStart
        ? !!(t.closest && t.closest('button, input, select, canvas, .leaflet-container'))
        : !!(t.closest && t.closest('#map, .leaflet-container, canvas, input, select, #modal'));
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', e => {
    if (swipeBlocked) return;
    const diffX = touchStartX - e.changedTouches[0].screenX;
    const diffY = touchStartY - e.changedTouches[0].screenY;
    if (Math.abs(diffX) > 70 && Math.abs(diffY) < 60) {
        if (statsSwipeStart && currentPage === 1) {
            const lastStatsSlide = document.querySelectorAll('[data-stats-slide]').length - 1;
            if (diffX > 0 && activeStatsSlide < lastStatsSlide) setStatsSlide(activeStatsSlide + 1);
            else if (diffX < 0 && activeStatsSlide > 0) setStatsSlide(activeStatsSlide - 1);
            return;
        }
        if (diffX > 0) goToAdjacentPage(1);
        else if (diffX < 0) goToAdjacentPage(-1);
    }
}, { passive: true });

const refreshSwiperPosition = () => requestAnimationFrame(() => setSwiperPosition(currentPage, true));
window.addEventListener('resize', refreshSwiperPosition, { passive: true });
window.addEventListener('orientationchange', refreshSwiperPosition, { passive: true });
window.visualViewport?.addEventListener('resize', refreshSwiperPosition, { passive: true });
if (typeof ResizeObserver !== 'undefined' && swiper.children[0]) {
    new ResizeObserver(refreshSwiperPosition).observe(swiper.children[0]);
}

window.addEventListener('pageshow', refreshSwiperPosition, { passive: true });

// ============================================================
