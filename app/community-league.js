'use strict';

// Liga de grupo: temporada activa, desafíos, títulos y actividad.
// Usa las rutas /api/mtb/groups/{challenges,awards,activity} de pb_hooks/group_league.pb.js.

const LEAGUE_STALE_MS = 60 * 1000;
const LEAGUE_METRIC_UNITS = {
    distance: { unit: 'km', decimals: 1 },
    elevation: { unit: 'm', decimals: 0 },
    activities: { unit: 'salidas', decimals: 0 },
    time: { unit: 'h', decimals: 1 }
};
const leagueState = {
    challenges: { loadedAt: 0, groupId: '', loading: false },
    awards: { loadedAt: 0, groupId: '', loading: false },
    activity: { loadedAt: 0, groupId: '', loading: false }
};

function leagueEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

function leagueReady() {
    return typeof Cloud !== 'undefined' && Cloud.loggedIn() && typeof groupJoined !== 'undefined' && groupJoined;
}

function leagueSetStatus(id, message, isError = false) {
    const status = $(id);
    if (!status) return;
    status.textContent = message || '';
    status.hidden = !message;
    status.classList.toggle('error', Boolean(isError));
}

function leagueErrorMessage(error, fallback) {
    if (error && error.status === 404 && /File not found|Not Found/i.test(error.message || '')) {
        return 'El servidor todavía no tiene la liga de grupo. Copia pb_hooks/ y pb_migrations/ en PocketBase y reinícialo.';
    }
    return `${fallback}: ${(error && error.message) || 'error de conexión'}`;
}

function leagueFormatValue(metric, value) {
    const def = LEAGUE_METRIC_UNITS[metric] || { unit: '', decimals: 0 };
    const number = Number(value) || 0;
    const text = def.decimals ? number.toFixed(def.decimals).replace(/\.0$/, '') : String(Math.round(number));
    if (metric === 'activities') return `${text} ${Math.round(number) === 1 ? 'salida' : 'salidas'}`;
    return `${text} ${def.unit}`;
}

function leagueFormatDay(iso) {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function leagueRelativeTime(iso) {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return '';
    const diff = Date.now() - time;
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'ayer';
    if (days < 7) return `hace ${days} días`;
    return leagueFormatDay(iso);
}

function leagueEmpty(container, message) {
    container.replaceChildren(leagueEl('p', 'hint league-empty', message));
}

// ---------------- Temporada y desafíos ----------------

function renderLeagueSeason(result) {
    const box = $('league-season');
    if (!box) return;
    const season = result && result.season;
    box.hidden = !season;
    if (!season) return;
    $('league-season-title').textContent = `Temporada ${season.seasonNumber} · semana ${season.currentWeek}/4`;
    $('league-season-days').textContent = `${season.daysRemaining} ${season.daysRemaining === 1 ? 'día' : 'días'} restantes`;
    const total = Number(season.endMs) - Number(season.startMs);
    const done = Math.min(1, Math.max(0, (Date.now() - Number(season.startMs)) / (total || 1)));
    $('league-season-bar').style.width = `${Math.round(done * 100)}%`;
    const list = $('league-standings');
    list.replaceChildren();
    const standings = Array.isArray(result.standings) ? result.standings.slice(0, 5) : [];
    if (!standings.some(item => item.leaguePoints > 0)) {
        list.appendChild(leagueEl('li', 'league-empty', 'Aún nadie ha sumado puntos esta temporada. Comparte una salida para estrenar la clasificación.'));
        return;
    }
    standings.forEach((item, index) => {
        const row = leagueEl('li', `league-standing${item.isMe ? ' is-me' : ''}`);
        row.append(
            leagueEl('span', 'league-standing-pos', `${index + 1}.º`),
            leagueEl('span', 'league-standing-name', item.nickname + (item.isMe ? ' (tú)' : '')),
            leagueEl('strong', '', `${Math.round(item.leaguePoints)} pts`)
        );
        list.appendChild(row);
    });
}

function renderLeagueChallenge(challenge) {
    const card = leagueEl('article', `league-challenge is-${challenge.status}`);
    const head = leagueEl('div', 'league-challenge-head');
    const title = leagueEl('div', 'league-challenge-title');
    title.append(leagueEl('strong', '', challenge.name));
    const statusLabel = { active: 'En curso', upcoming: 'Próximo', finished: 'Terminado' }[challenge.status] || '';
    title.append(leagueEl('small', '', `${statusLabel} · ${leagueFormatDay(challenge.startsAt)} – ${leagueFormatDay(challenge.endsAt)} · meta ${leagueFormatValue(challenge.metric, challenge.target)}`));
    head.appendChild(title);
    if (challenge.canDelete) {
        const remove = leagueEl('button', 'btn-small secondary league-challenge-delete', 'Eliminar');
        remove.type = 'button';
        remove.dataset.challengeId = challenge.id;
        remove.dataset.challengeName = challenge.name;
        remove.setAttribute('aria-label', `Eliminar el desafío ${challenge.name}`);
        head.appendChild(remove);
    }
    card.appendChild(head);

    const mine = challenge.mine;
    if (mine) {
        const me = leagueEl('div', 'league-challenge-mine');
        const bar = leagueEl('div', 'league-progress');
        const fill = document.createElement('i');
        fill.style.width = `${mine.percent}%`;
        bar.appendChild(fill);
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuenow', String(mine.percent));
        bar.setAttribute('aria-label', `Tu progreso en ${challenge.name}`);
        me.append(
            leagueEl('span', '', mine.completed ? '✅ Completado' : `Tu progreso: ${leagueFormatValue(challenge.metric, mine.value)} · ${mine.percent}%`),
            bar
        );
        card.appendChild(me);
    }

    const ranking = leagueEl('ol', 'league-challenge-ranking');
    const riders = (challenge.progress || []).filter(item => item.value > 0).slice(0, 5);
    if (!riders.length) {
        ranking.appendChild(leagueEl('li', 'league-empty', 'Todavía no hay salidas compartidas dentro de las fechas del desafío.'));
    } else {
        riders.forEach((item, index) => {
            const row = leagueEl('li', item.completed ? 'is-completed' : '');
            row.append(
                leagueEl('span', 'league-standing-pos', `${index + 1}.º`),
                leagueEl('span', 'league-standing-name', item.nickname),
                leagueEl('strong', '', `${leagueFormatValue(challenge.metric, item.value)}${item.completed ? ' ✓' : ''}`)
            );
            ranking.appendChild(row);
        });
    }
    card.appendChild(ranking);
    const footer = `Creado por ${challenge.createdBy}` + (challenge.completedCount ? ` · ${challenge.completedCount} ${challenge.completedCount === 1 ? 'miembro lo ha completado' : 'miembros lo han completado'}` : '');
    card.appendChild(leagueEl('small', 'league-challenge-footer', footer));
    return card;
}

function renderLeagueChallenges(result) {
    const list = $('league-challenges-list');
    if (!list) return;
    const challenges = Array.isArray(result && result.challenges) ? result.challenges : [];
    if (!challenges.length) {
        leagueEmpty(list, 'El grupo no tiene desafíos vigentes. Crea uno: cualquier miembro puede proponerlo.');
        return;
    }
    list.replaceChildren(...challenges.map(renderLeagueChallenge));
}

async function loadLeagueChallenges(force = false) {
    const state = leagueState.challenges;
    if (!leagueReady()) {
        renderLeagueSeason(null);
        const list = $('league-challenges-list');
        if (list) list.replaceChildren();
        leagueSetStatus('league-challenges-status', 'Inicia sesión y únete a un grupo para ver y crear desafíos.');
        $('league-create')?.setAttribute('hidden', '');
        return;
    }
    $('league-create')?.removeAttribute('hidden');
    const groupId = groupName();
    if (!force && state.groupId === groupId && Date.now() - state.loadedAt < LEAGUE_STALE_MS) return;
    if (state.loading) return;
    state.loading = true;
    leagueSetStatus('league-challenges-status', 'Cargando desafíos…');
    try {
        const result = await cloudApi('/api/mtb/groups/challenges');
        if (groupName() !== groupId) return;
        state.loadedAt = Date.now();
        state.groupId = groupId;
        renderLeagueSeason(result);
        renderLeagueChallenges(result);
        leagueSetStatus('league-challenges-status', '');
        const season = result.season;
        if (season && typeof renderCommunityCompetitionStatus === 'function') {
            renderCommunityCompetitionStatus(`${result.group.name} · Temporada ${season.seasonNumber}, semana ${season.currentWeek}/4 · ${season.daysRemaining} días restantes.`);
        }
    } catch (error) {
        console.warn('No se pudieron cargar los desafíos:', error);
        leagueSetStatus('league-challenges-status', leagueErrorMessage(error, 'No se pudieron cargar los desafíos'), true);
    } finally {
        state.loading = false;
    }
}

function leagueDefaultEndDate() {
    const end = new Date();
    end.setDate(end.getDate() + 14);
    return end.toISOString().slice(0, 10);
}

async function submitLeagueChallenge(event) {
    event.preventDefault();
    if (!leagueReady()) { toast('Inicia sesión y únete a un grupo para crear desafíos.'); return; }
    if (!navigator.onLine) { toast('Necesitas conexión para crear un desafío.'); return; }
    const name = $('league-challenge-name').value.trim();
    const metric = $('league-challenge-metric').value;
    const target = Number(String($('league-challenge-target').value).replace(',', '.'));
    const endsAt = $('league-challenge-end').value;
    if (name.length < 3) { toast('Ponle al desafío un nombre de al menos 3 caracteres.'); $('league-challenge-name').focus(); return; }
    if (!Number.isFinite(target) || target < 10 || target > 20000) {
        toast('La meta debe estar entre 10 y 20.000.');
        $('league-challenge-target').focus();
        return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) { toast('Elige la fecha de fin del desafío.'); $('league-challenge-end').focus(); return; }
    const submit = $('league-challenge-submit');
    submit.disabled = true;
    try {
        await cloudApi('/api/mtb/groups/challenges', 'POST', { name, metric, target, endsAt });
        toast('Desafío creado. ¡A rodar!');
        $('league-challenge-form').reset();
        $('league-challenge-end').value = leagueDefaultEndDate();
        $('league-create').open = false;
        leagueState.activity.loadedAt = 0;
        await loadLeagueChallenges(true);
    } catch (error) {
        toast(leagueErrorMessage(error, 'No se pudo crear el desafío'), 6000);
    } finally {
        submit.disabled = false;
    }
}

async function deleteLeagueChallenge(button) {
    const confirmed = await modal({ message: `¿Eliminar el desafío «${button.dataset.challengeName}»? Se perderá su clasificación.`, ok: 'Eliminar' });
    if (!confirmed) return;
    button.disabled = true;
    try {
        await cloudApi('/api/mtb/groups/challenges/delete', 'POST', { id: button.dataset.challengeId });
        toast('Desafío eliminado.');
        leagueState.activity.loadedAt = 0;
        await loadLeagueChallenges(true);
    } catch (error) {
        button.disabled = false;
        toast(leagueErrorMessage(error, 'No se pudo eliminar el desafío'), 6000);
    }
}

// ---------------- Títulos y palmarés ----------------

function renderLeagueTitles(container, titles, compact = false) {
    container.replaceChildren();
    (titles || []).forEach(title => {
        const item = leagueEl('div', `league-title${title.winner ? '' : ' is-empty'}${compact ? ' is-compact' : ''}`);
        item.append(leagueEl('span', 'league-title-icon', title.icon));
        const text = leagueEl('div', 'league-title-text');
        text.append(leagueEl('small', '', title.name));
        text.append(leagueEl('strong', '', title.winner ? title.winner.nickname : 'Sin dueño'));
        text.append(leagueEl('span', '', title.winner ? title.winner.value : title.description));
        item.appendChild(text);
        container.appendChild(item);
    });
}

function renderLeagueAwards(result) {
    const current = $('league-current-titles');
    if (current) renderLeagueTitles(current, result.current && result.current.titles);
    const season = result.current && result.current.season;
    if (season) {
        leagueSetStatus('league-awards-status', `Temporada ${season.seasonNumber} · ${season.daysRemaining} ${season.daysRemaining === 1 ? 'día' : 'días'} para cerrar los títulos.`);
    }
    const medalTable = $('league-medal-table');
    const history = $('league-awards-history');
    const challengeMedals = $('league-challenge-medals');
    const medals = Array.isArray(result.medalTable) ? result.medalTable : [];
    if (medalTable) {
        medalTable.replaceChildren();
        if (medals.length) {
            const list = leagueEl('ol', 'league-standings');
            medals.slice(0, 10).forEach((medal, index) => {
                const row = leagueEl('li', 'league-standing');
                row.append(
                    leagueEl('span', 'league-standing-pos', `${index + 1}.º`),
                    leagueEl('span', 'league-standing-name', medal.nickname),
                    leagueEl('strong', '', `${medal.count} ${medal.count === 1 ? 'título' : 'títulos'}`)
                );
                list.appendChild(row);
            });
            medalTable.appendChild(list);
        }
    }
    if (history) {
        const seasons = Array.isArray(result.history) ? result.history : [];
        if (!seasons.length) {
            leagueEmpty(history, 'El palmarés se llenará al cerrar la primera temporada con salidas compartidas.');
        } else {
            history.replaceChildren(...seasons.map(item => {
                const block = leagueEl('details', 'league-history-season');
                const summary = leagueEl('summary', '', `Temporada ${item.season.seasonNumber} · ${leagueFormatDay(item.season.startDate)} – ${leagueFormatDay(item.season.endDate)}`);
                const champion = item.titles.find(title => title.key === 'champion');
                if (champion && champion.winner) summary.appendChild(leagueEl('span', 'league-history-champion', ` 🏆 ${champion.winner.nickname}`));
                const grid = leagueEl('div', 'league-titles');
                renderLeagueTitles(grid, item.titles, true);
                block.append(summary, grid);
                return block;
            }));
        }
    }
    if (challengeMedals) {
        const awards = Array.isArray(result.challengeMedals) ? result.challengeMedals : [];
        if (!awards.length) {
            leagueEmpty(challengeMedals, 'Cuando termine un desafío, quienes hayan alcanzado su meta recibirán aquí una medalla.');
        } else {
            challengeMedals.replaceChildren(...awards.map(award => {
                const card = leagueEl('article', 'league-challenge-medal');
                const head = leagueEl('div', 'league-challenge-medal-head');
                const title = leagueEl('div', 'league-challenge-medal-title');
                title.append(
                    leagueEl('strong', '', award.name),
                    leagueEl('small', '', `Meta ${leagueFormatValue(award.metric, award.target)} · terminó el ${leagueFormatDay(new Date(award.endsAtMs).toISOString())}`)
                );
                head.append(
                    leagueEl('span', 'league-challenge-medal-icon', '🏅'),
                    title
                );
                const recipients = leagueEl('ul', 'league-challenge-medal-recipients');
                (award.recipients || []).forEach(recipient => {
                    recipients.appendChild(leagueEl('li', '', `${recipient.nickname} · meta alcanzada el ${leagueFormatDay(new Date(recipient.completedAtMs).toISOString())}`));
                });
                card.append(head, recipients);
                return card;
            }));
        }
    }
}

async function loadLeagueAwards(force = false) {
    const state = leagueState.awards;
    if (!leagueReady()) {
        $('league-current-titles')?.replaceChildren();
        $('league-medal-table')?.replaceChildren();
        $('league-awards-history')?.replaceChildren();
        $('league-challenge-medals')?.replaceChildren();
        leagueSetStatus('league-awards-status', 'Inicia sesión y únete a un grupo para consultar los títulos.');
        return;
    }
    const groupId = groupName();
    if (!force && state.groupId === groupId && Date.now() - state.loadedAt < LEAGUE_STALE_MS) return;
    if (state.loading) return;
    state.loading = true;
    leagueSetStatus('league-awards-status', 'Cargando títulos…');
    try {
        const result = await cloudApi('/api/mtb/groups/awards');
        if (groupName() !== groupId) return;
        state.loadedAt = Date.now();
        state.groupId = groupId;
        renderLeagueAwards(result);
    } catch (error) {
        console.warn('No se pudieron cargar los títulos:', error);
        leagueSetStatus('league-awards-status', leagueErrorMessage(error, 'No se pudieron cargar los títulos'), true);
    } finally {
        state.loading = false;
    }
}

// ---------------- Actividad ----------------

const LEAGUE_RECORD_LABELS = { distance: 'distancia', elevation: 'desnivel', speed: 'velocidad punta' };

function renderLeagueFeedItem(item) {
    const row = leagueEl('li', `league-feed-item is-${item.type}${item.isMe ? ' is-me' : ''}`);
    const who = item.isMe ? 'Tú' : item.nickname;
    let icon = '🚵';
    let text = '';
    let detail = '';
    if (item.type === 'activity') {
        const parts = [];
        if (item.distanceKm > 0) parts.push(`${Number(item.distanceKm).toFixed(1)} km`);
        if (item.elevationGain > 0) parts.push(`+${item.elevationGain} m`);
        if (item.movingTimeSec > 0) parts.push(fmtDur(item.movingTimeSec));
        text = `${who} ${item.isMe ? 'compartiste' : 'compartió'} una salida`;
        detail = `${parts.join(' · ')} · ${item.points} pts`;
        if (item.groupRecords && item.groupRecords.length) {
            icon = '⭐';
            detail += ` · Récord del grupo en ${item.groupRecords.map(key => LEAGUE_RECORD_LABELS[key] || key).join(', ')}`;
        }
    } else if (item.type === 'challenge-created') {
        icon = '◎';
        text = `${who} ${item.isMe ? 'creaste' : 'creó'} el desafío «${item.challengeName}»`;
    } else if (item.type === 'challenge-completed') {
        icon = '✅';
        text = `${who} ${item.isMe ? 'completaste' : 'completó'} el desafío «${item.challengeName}»`;
    }
    const iconEl = leagueEl('span', 'league-feed-icon', icon);
    iconEl.setAttribute('aria-hidden', 'true');
    const body = leagueEl('div', 'league-feed-body');
    body.append(leagueEl('strong', '', text));
    if (detail) body.append(leagueEl('span', '', detail));
    const time = leagueEl('time', '', leagueRelativeTime(item.time));
    time.dateTime = item.time;
    row.append(iconEl, body, time);
    return row;
}

async function loadLeagueActivity(force = false) {
    const state = leagueState.activity;
    const feed = $('community-activity-feed');
    if (!leagueReady()) {
        feed?.replaceChildren();
        leagueSetStatus('league-activity-status', 'Inicia sesión y únete a un grupo para ver su actividad.');
        return;
    }
    const groupId = groupName();
    if (!force && state.groupId === groupId && Date.now() - state.loadedAt < LEAGUE_STALE_MS) return;
    if (state.loading) return;
    state.loading = true;
    leagueSetStatus('league-activity-status', 'Cargando actividad…');
    try {
        const result = await cloudApi('/api/mtb/groups/activity');
        if (groupName() !== groupId) return;
        state.loadedAt = Date.now();
        state.groupId = groupId;
        const items = Array.isArray(result.items) ? result.items : [];
        if (!items.length) {
            feed.replaceChildren();
            leagueSetStatus('league-activity-status', 'Sin actividad en los últimos 90 días. Las salidas compartidas con el grupo aparecerán aquí.');
        } else {
            feed.replaceChildren(...items.map(renderLeagueFeedItem));
            leagueSetStatus('league-activity-status', '');
        }
    } catch (error) {
        console.warn('No se pudo cargar la actividad del grupo:', error);
        leagueSetStatus('league-activity-status', leagueErrorMessage(error, 'No se pudo cargar la actividad'), true);
    } finally {
        state.loading = false;
    }
}

// ---------------- Integración con la pestaña Comunidad ----------------

function communityActiveSection() {
    const tab = document.querySelector('[data-community-section].active');
    return tab ? tab.dataset.communitySection : 'ranking';
}

function loadCommunityLeagueSection(section, force = false) {
    if (section === 'challenges') return loadLeagueChallenges(force);
    if (section === 'achievements') return loadLeagueAwards(force);
    if (section === 'activity') return loadLeagueActivity(force);
    return null;
}

// Se llama al cambiar de grupo, iniciar/cerrar sesión o compartir una salida.
function refreshCommunityLeague() {
    Object.values(leagueState).forEach(state => { state.loadedAt = 0; });
    if (typeof currentPage !== 'undefined' && currentPage !== 2) return;
    loadCommunityLeagueSection(communityActiveSection(), true);
}

document.querySelector('.community-hub')?.addEventListener('click', event => {
    const tab = event.target.closest('[data-community-section]');
    if (tab) loadCommunityLeagueSection(tab.dataset.communitySection);
});
$('league-challenges-refresh')?.addEventListener('click', () => loadLeagueChallenges(true));
$('league-awards-refresh')?.addEventListener('click', () => loadLeagueAwards(true));
$('league-activity-refresh')?.addEventListener('click', () => loadLeagueActivity(true));
$('league-challenge-form')?.addEventListener('submit', submitLeagueChallenge);
$('league-challenges-list')?.addEventListener('click', event => {
    const button = event.target.closest('.league-challenge-delete');
    if (button) deleteLeagueChallenge(button);
});
if ($('league-challenge-end')) {
    $('league-challenge-end').value = leagueDefaultEndDate();
    $('league-challenge-end').min = new Date().toISOString().slice(0, 10);
}
