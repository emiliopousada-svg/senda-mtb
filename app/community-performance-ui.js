'use strict';

// Public performance rankings and submission UI.

function communityRecordCollectionUrl(collection, filter, fields = 'id,alias,elapsedSeconds', sort = 'elapsedSeconds', perPage = 50) {
    return `/api/collections/${collection}/records?perPage=${perPage}&sort=${sort}&fields=${fields}&filter=${encodeURIComponent(filter)}`;
}

function communityRenderRanking(records, container, totalItems = records.length, options = {}) {
    container.replaceChildren();
    const podium = options.podium === true;
    const limit = podium
        ? Math.min(3, Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 3)
        : 10;
    const valid = records.filter(record => record && typeof record.alias === 'string'
        && record.alias.trim() && Number.isFinite(Number(record.elapsedSeconds))
        && Number(record.elapsedSeconds) > 0 && Number(record.elapsedSeconds) <= 86400)
        .sort((a, b) => Number(a.elapsedSeconds) - Number(b.elapsedSeconds))
        .slice(0, limit);
    if (!valid.length) {
        const empty = document.createElement('p');
        empty.className = 'community-empty';
        empty.textContent = podium
            ? 'Aún no hay tiempos publicados. ¡Sé el primero en marcarlo!'
            : 'Todavía no hay marcas publicadas para este trazado.';
        container.append(empty);
        return;
    }
    valid.forEach((record, index) => {
        const row = document.createElement('div');
        row.className = podium
            ? 'community-ranking-item community-ranking-podium-item'
            : 'community-ranking-item';
        const place = document.createElement('span');
        place.className = 'community-ranking-place';
        place.textContent = podium ? ['🥇', '🥈', '🥉'][index] : `${index + 1}.`;
        if (podium) place.setAttribute('aria-label', `${index + 1}.ª posición`);
        const name = document.createElement('span');
        name.className = 'community-ranking-name';
        name.textContent = record.alias.trim();
        const time = document.createElement('strong');
        time.className = 'community-ranking-time';
        time.textContent = fmtDur(Number(record.elapsedSeconds));
        row.append(place, name, time);
        container.append(row);
    });
    if (!podium && totalItems > valid.length) {
        const more = document.createElement('p');
        more.className = 'hint';
        more.textContent = `Mostrando las ${valid.length} mejores marcas de ${totalItems}.`;
        container.append(more);
    }
}

function communityRenderPersonalBest(record, container) {
    container.replaceChildren();
    const label = document.createElement('span');
    label.className = 'community-personal-best-label';
    label.textContent = 'TU MEJOR TIEMPO';
    const time = document.createElement('strong');
    time.className = 'community-personal-best-time';
    const details = document.createElement('span');
    details.className = 'community-personal-best-details';
    if (!Cloud.loggedIn()) {
        details.textContent = 'Inicia sesión para ver tu marca personal.';
    } else if (record && Number(record.elapsedSeconds) > 0) {
        time.textContent = fmtDur(Number(record.elapsedSeconds));
        details.textContent = 'Récord histórico en este segmento';
    } else {
        details.textContent = 'Aún no tienes una marca en este segmento.';
    }
    container.append(label, time, details);
}

async function communityLoadSegmentRanking(record, podiumContainer, personalContainer) {
    const isCurrentTarget = () => podiumContainer.isConnected && personalContainer.isConnected;
    if (!record || !record.id || !isCurrentTarget()) return;
    const setFailure = (container, error, label) => {
        const failure = document.createElement('p');
        failure.className = 'community-empty error';
        failure.textContent = error.status === 404
            ? 'No está instalada la colección de tiempos de segmentos.'
            : `No se pudo cargar ${label}: ${error.message || 'error de conexión'}`;
        container.replaceChildren(failure);
    };
    const loadPodium = async () => {
        const server = Cloud.server;
        try {
            const result = await cloudApi(communityRecordCollectionUrl(
                'community_segment_efforts',
                `segment = "${record.id}"`,
                'id,alias,elapsedSeconds',
                'elapsedSeconds',
                3
            ));
            if (!isCurrentTarget()) return;
            if (Cloud.server !== server) return loadPodium();
            communityRenderRanking(Array.isArray(result.items) ? result.items : [], podiumContainer,
                Number(result.totalItems) || 0, { limit: 3, podium: true });
        } catch (error) {
            if (!isCurrentTarget()) return;
            if (Cloud.server !== server) return loadPodium();
            console.warn(`No se pudo cargar el podio de ${record.title || 'el segmento'}:`, error);
            setFailure(podiumContainer, error, 'el podio');
        }
    };
    const loadPersonalBest = async () => {
        if (!Cloud.loggedIn()) {
            communityRenderPersonalBest(null, personalContainer);
            return;
        }
        const uid = Cloud.uid;
        const server = Cloud.server;
        const authGeneration = Cloud.authGeneration;
        const isSameAccount = () => Cloud.loggedIn() && Cloud.uid === uid
            && Cloud.server === server && Cloud.authGeneration === authGeneration;
        const reloadForCurrentAccount = () => {
            if (!isCurrentTarget()) return;
            if (!Cloud.loggedIn()) {
                communityRenderPersonalBest(null, personalContainer);
                return;
            }
            return loadPersonalBest();
        };
        try {
            const result = await cloudApi(communityRecordCollectionUrl(
                'community_segment_efforts',
                `segment = "${record.id}" && owner = "${uid}"`,
                'id,alias,elapsedSeconds',
                'elapsedSeconds',
                1
            ));
            if (!isCurrentTarget()) return;
            if (!isSameAccount()) {
                return reloadForCurrentAccount();
            }
            communityRenderPersonalBest(Array.isArray(result.items) ? result.items[0] || null : null,
                personalContainer);
        } catch (error) {
            if (!isCurrentTarget()) return;
            if (!isSameAccount()) {
                return reloadForCurrentAccount();
            }
            console.warn(`No se pudo cargar el récord personal de ${record.title || 'el segmento'}:`, error);
            setFailure(personalContainer, error, 'tu mejor tiempo');
        }
    };
    await Promise.all([loadPodium(), loadPersonalBest()]);
}
