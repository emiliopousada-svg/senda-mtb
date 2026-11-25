'use strict';

const PRODUCTION_HOST = 'mtbpro.ddns.net';
const COMMUNITY_COLLECTIONS = [
    'community_routes',
    'community_route_comments',
    'community_route_ratings'
];

function validateStagingServer(value) {
    let url;
    try {
        url = new URL(String(value || '').trim());
    } catch (_) {
        throw new Error('MTB_STAGING_SERVER debe ser una URL HTTPS válida.');
    }

    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.pathname !== '/' || url.hostname.toLowerCase() === PRODUCTION_HOST) {
        throw new Error('MTB_STAGING_SERVER debe apuntar por HTTPS al staging, no a producción.');
    }

    return url.origin;
}

async function request(fetchImpl, baseUrl, route, options = {}) {
    try {
        return await fetchImpl(new URL(route, baseUrl), {
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
            ...options
        });
    } catch (error) {
        throw new Error(`No se pudo completar la comprobación PocketBase (${route}): ${error.message}`);
    }
}

async function runStagingSmoke({ server, email, password, fetchImpl = fetch }) {
    const baseUrl = validateStagingServer(server);
    if (!String(email || '').trim() || !String(password || '')) {
        throw new Error('Configura PB_STAGING_SMOKE_EMAIL y PB_STAGING_SMOKE_PASSWORD.');
    }

    const health = await request(fetchImpl, baseUrl, '/api/health');
    if (!health.ok) throw new Error(`El health check de PocketBase devolvió HTTP ${health.status}.`);

    const authResponse = await request(fetchImpl, baseUrl, '/api/collections/users/auth-with-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: email, password })
    });
    if (!authResponse.ok) {
        throw new Error(`La autenticación de la cuenta de smoke test devolvió HTTP ${authResponse.status}.`);
    }

    const auth = await authResponse.json();
    if (!auth || typeof auth.token !== 'string' || !auth.token || !auth.record || !auth.record.id) {
        throw new Error('PocketBase no devolvió una sesión válida para el smoke test.');
    }
    const headers = { Authorization: auth.token };

    for (const collection of COMMUNITY_COLLECTIONS) {
        const response = await request(
            fetchImpl,
            baseUrl,
            `/api/collections/${collection}/records?perPage=1&fields=id`,
            { headers }
        );
        if (!response.ok) {
            throw new Error(`La colección ${collection} no está disponible para la cuenta de smoke test (HTTP ${response.status}).`);
        }
        const page = await response.json();
        if (!page || !Array.isArray(page.items)) {
            throw new Error(`La respuesta de ${collection} no tiene el formato esperado.`);
        }
    }

    const groupProbe = await request(fetchImpl, baseUrl, '/api/mtb/groups/create', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' })
    });
    let groupError;
    try { groupError = await groupProbe.json(); }
    catch (_) { groupError = null; }
    if (groupProbe.status !== 400 || !groupError || groupError.message !== 'Escribe un nombre para el grupo.') {
        throw new Error('El endpoint autenticado de grupos no respondió con la validación esperada.');
    }

    return { collectionsChecked: COMMUNITY_COLLECTIONS.length };
}

async function main() {
    try {
        const result = await runStagingSmoke({
            server: process.env.MTB_STAGING_SERVER,
            email: process.env.PB_STAGING_SMOKE_EMAIL,
            password: process.env.PB_STAGING_SMOKE_PASSWORD
        });
        console.log(`PocketBase staging smoke OK: health, auth, ${result.collectionsChecked} colecciones y hook de grupos.`);
    } catch (error) {
        console.error(`PocketBase staging smoke failed: ${error.message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = { COMMUNITY_COLLECTIONS, runStagingSmoke, validateStagingServer };
