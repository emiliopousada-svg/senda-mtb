'use strict';

//  NAVEGACIÓN ENTRE PÁGINAS
// ============================================================
let currentPage = 5;
const pageHistory = [currentPage];
const swiper = $('swiper');
const navBtns = document.querySelectorAll('.nav-btn');
const carouselPageOrder = [5, 3, 0, 2, 1, 4, 6, 7];

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

    const pageOffset = targetPage.offsetLeft;
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
    currentPage = index;
    setSwiperPosition(index);
    const navPage = index === 6 ? 0 : index;
    navBtns.forEach(btn => btn.classList.toggle('active', Number(btn.dataset.page) === navPage));
    document.body.dataset.currentPage = String(index);
    if (typeof dashboardUpdateNav === 'function') dashboardUpdateNav(index);
    if (index === 6 && typeof cockpitRender === 'function') cockpitRender();
    if (index === 1 && statsNeedsRefresh) requestAnimationFrame(refreshStats);
    if (index === 2 && typeof loadGroupRankings === 'function') loadGroupRankings();
    if (index === 0 && map) setTimeout(() => map.invalidateSize(), 150);
    if (index === 5) {
        if (statsNeedsRefresh) requestAnimationFrame(refreshStats);
        if (typeof dashboardRender === 'function') dashboardRender();
    }
    if (index === 4) {
        if (typeof renderAccount === 'function') renderAccount();
        openOfflineMaps();
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

function goBackPage() {
    if (pageHistory.length <= 1) return false;
    pageHistory.pop();
    renderPage(pageHistory[pageHistory.length - 1]);
    return true;
}

// Android delega aquí el botón Atrás para navegar por las páginas antes de salir.
// Devolver true significa que la pulsación quedó atendida por la aplicación.
window.mtbHandleHardwareBack = function () {
    if (currentPage > 0) {
        const previousPage = currentPage === 5 ? 0
            : currentPage === 6 || currentPage === 7 ? 5
                : currentPage - 1;
        goToPage(previousPage);
        return true;
    }
    if (isRecording) {
        toast('La grabación sigue activa. Finalízala antes de salir de la aplicación.', 5000);
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
