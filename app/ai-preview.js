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
