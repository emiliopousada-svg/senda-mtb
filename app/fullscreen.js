'use strict';

const fullscreenToggle = document.getElementById('screen-fullscreen-toggle');
const fullscreenExit = document.getElementById('fullscreen-exit');

function setImmersiveMode(active) {
    document.body.classList.toggle('app-immersive', active);
    if (fullscreenToggle) {
        fullscreenToggle.setAttribute('aria-label', active ? 'Salir de pantalla completa' : 'Activar modo pantalla completa');
        fullscreenToggle.setAttribute('aria-pressed', String(active));
        fullscreenToggle.title = active ? 'Salir de pantalla completa' : 'Pantalla completa';
        fullscreenToggle.textContent = active ? '⤢' : '⛶';
    }
    if (fullscreenExit) fullscreenExit.hidden = !active;
    if (typeof currentPage === 'number' && typeof setSwiperPosition === 'function') {
        requestAnimationFrame(() => setSwiperPosition(currentPage, true));
    }
}

async function toggleImmersiveMode() {
    const active = !document.body.classList.contains('app-immersive');
    setImmersiveMode(active);
    if (active && document.documentElement.requestFullscreen) {
        try { await document.documentElement.requestFullscreen(); }
        catch { /* El modo inmersivo CSS sigue disponible si el WebView no ofrece Fullscreen API. */ }
    } else if (!active && document.fullscreenElement && document.exitFullscreen) {
        try { await document.exitFullscreen(); }
        catch { /* La aplicación ya salió del modo inmersivo CSS. */ }
    }
}

fullscreenToggle?.addEventListener('click', toggleImmersiveMode);
fullscreenExit?.addEventListener('click', toggleImmersiveMode);
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('app-immersive')) setImmersiveMode(false);
});
