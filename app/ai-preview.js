'use strict';

const aiPreviewForm = document.getElementById('ai-preview-form');
aiPreviewForm?.addEventListener('submit', event => {
    event.preventDefault();
    const input = document.getElementById('ai-preview-input');
    const status = document.getElementById('ai-preview-status');
    if (!input?.value.trim() || !status) return;
    status.textContent = 'CAMBOYA AI es todavía un concepto. No se ha enviado tu pregunta ni ningún dato.';
    status.dataset.state = 'notice';
    input.value = '';
});

document.querySelector('.tools-grid')?.addEventListener('click', event => {
    const button = event.target.closest('[data-tool]');
    if (!button) return;
    switch (button.dataset.tool) {
        case 'ai':
            document.getElementById('ai-preview-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            document.getElementById('ai-preview-input')?.focus({ preventScroll: true });
            break;
        case 'settings':
            goToPage(4);
            break;
        default:
            toast('Esta herramienta está en planificación y todavía no está activa.');
    }
});
