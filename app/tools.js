'use strict';

const toolsWorkspaceIds = [
    'safety-workspace',
    'garage-workspace',
    'calendar-workspace',
    'recording-settings-workspace',
    'sensors-workspace',
    'maps-workspace',
    'social-workspace',
    'misc-settings-workspace'
];

function toolsScrollToTop() {
    // La página de herramientas es una lámina dentro de un carrusel horizontal.
    // scrollIntoView() también puede desplazar ese carrusel y desalinear las pestañas.
    document.querySelector('.tools-page')?.scrollTo({ top: 0, behavior: 'auto' });
}

function toolsOpenWorkspace(id) {
    const workspace = document.getElementById(id);
    const hub = document.querySelector('.tools-hub');
    const heading = document.querySelector('.tools-page-heading');
    if (!workspace || !hub || !heading) {
        console.error(`No se pudo abrir el espacio de herramientas "${id}".`);
        return;
    }

    toolsWorkspaceIds.forEach(workspaceId => {
        const item = document.getElementById(workspaceId);
        if (item) item.hidden = item !== workspace;
    });
    hub.hidden = true;
    heading.hidden = true;
    workspace.hidden = false;
    toolsScrollToTop();
}

function toolsCloseWorkspaces() {
    const hub = document.querySelector('.tools-hub');
    const heading = document.querySelector('.tools-page-heading');
    const workspaces = toolsWorkspaceIds
        .map(id => document.getElementById(id));
    const dialog = document.getElementById('calendar-create-dialog');
    workspaces.forEach(workspace => {
        if (workspace) workspace.hidden = true;
    });
    if (dialog && dialog.open && typeof dialog.close === 'function') dialog.close();
    if (hub) hub.hidden = false;
    if (heading) heading.hidden = false;
}

function toolsHandleBackButton() {
    const hub = document.querySelector('.tools-hub');
    if (!hub || !hub.hidden) return false;
    toolsCloseWorkspaces();
    toolsScrollToTop();
    return true;
}

// Centro de control: cada tarjeta abre su espacio de trabajo.
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
        case 'calendar':
            if (typeof calendarOpenWorkspace === 'function') calendarOpenWorkspace();
            break;
        case 'recording':
            toolsOpenWorkspace('recording-settings-workspace');
            break;
        case 'sensors':
            toolsOpenWorkspace('sensors-workspace');
            break;
        case 'maps':
            toolsOpenWorkspace('maps-workspace');
            openOfflineMaps();
            break;
        case 'social':
            toolsOpenWorkspace('social-workspace');
            break;
        case 'misc-settings':
            toolsOpenWorkspace('misc-settings-workspace');
            break;
        default:
            console.error(`Herramienta desconocida en el centro de control: "${button.dataset.tool}".`);
    }
});

document.querySelector('.tools-page')?.addEventListener('click', event => {
    if (event.target.closest('[data-tools-back]')) {
        toolsCloseWorkspaces();
        toolsScrollToTop();
    }
});
