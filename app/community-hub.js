'use strict';

function communitySetSection(key, moveFocus = false) {
    const tabs = [...document.querySelectorAll('[data-community-section]')];
    const tab = tabs.find(item => item.dataset.communitySection === key);
    if (!tab) return;
    tabs.forEach(item => {
        const selected = item === tab;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
        const panel = $(item.getAttribute('aria-controls'));
        if (panel) panel.hidden = !selected;
    });
    if (moveFocus) tab.focus();
}

const communityHub = document.querySelector('.community-hub');
communityHub?.addEventListener('click', event => {
    const tab = event.target.closest('[data-community-section]');
    if (tab) communitySetSection(tab.dataset.communitySection);
});
communityHub?.addEventListener('keydown', event => {
    const tabs = [...communityHub.querySelectorAll('[data-community-section]')];
    const index = tabs.indexOf(event.target.closest('[data-community-section]'));
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    communitySetSection(tabs[next].dataset.communitySection, true);
});

document.querySelectorAll('[data-community-section]').forEach((tab, index) => {
    tab.tabIndex = index === 0 ? 0 : -1;
    const panel = $(tab.getAttribute('aria-controls'));
    if (panel) panel.hidden = index !== 0;
});

$('community-open-segments')?.addEventListener('click', () => {
    goToPage(3);
    setRoutesTab('community');
});

$('community-open-season')?.addEventListener('click', () => {
    const status = $('community-competition-status');
    if (!Cloud.loggedIn() || !groupJoined) {
        communitySetSection('group');
        const message = 'Inicia sesión y únete a un grupo para consultar la temporada activa.';
        status.textContent = message;
        if ($('group-status')) $('group-status').textContent = message;
        $('group-setup')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    communitySetSection('challenges');
    loadGroupRankings();
    status.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('community-open-ranking')?.addEventListener('click', () => {
    communitySetSection('ranking');
    loadGroupRankings();
});
