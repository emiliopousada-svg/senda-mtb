'use strict';

// Más herramientas: cada tarjeta abre su espacio de trabajo o una página de la app.
document.querySelector('.tools-grid')?.addEventListener('click', event => {
    const button = event.target.closest('[data-tool]');
    if (!button) return;
    switch (button.dataset.tool) {
        case 'safety':
            if (typeof safetyOpenWorkspace === 'function') safetyOpenWorkspace();
            break;
        case 'garage':
            if (typeof garageOpenWorkspace === 'function') garageOpenWorkspace();
            break;
        case 'settings':
            goToPage(4);
            break;
        default:
            toast('Esta herramienta está en planificación y todavía no está activa.');
    }
});
