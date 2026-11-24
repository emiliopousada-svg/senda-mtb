const CLOUD_TIMEOUT_MS = 10000;

function isRetryableCloudStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}

async function cloudApi(path, method = 'GET', body = null, options = {}) {
    const timeoutMs = typeof options === 'number' ? options : (options?.timeoutMs || CLOUD_TIMEOUT_MS);
    const headers = {};
    if (typeof options === 'object' && options?.authorization) {
        headers.Authorization = options.authorization;
    } else {
        const token = await Cloud.getSessionToken();
        if (token) headers.Authorization = token;
    }
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const server = typeof options === 'object' && options?.server ? options.server : Cloud.server;
    const url = new URL(server + path);
    const isLocalHttp = APP_CONFIG.allowLocalHttpServer
        && url.protocol === 'http:'
        && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if ((url.protocol !== 'https:' && !isLocalHttp) || url.username || url.password) {
        throw new Error('El servidor debe usar una dirección HTTPS válida.');
    }

    const controller = new AbortController();
    if (options?.signal) {
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else options.signal.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });
    }
    const timer = setTimeout(() => {
        const timeoutErr = new Error('Tiempo de espera agotado al conectar con el servidor');
        timeoutErr.name = 'TimeoutError';
        controller.abort(timeoutErr);
    }, timeoutMs);

    try {
        const res = await fetch(url.href, {
            method,
            headers,
            body: payload,
            signal: controller.signal,
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error'
        });
        if (typeof dashboardSetServerStatus === 'function') dashboardSetServerStatus('connected', server);
        if (!res.ok) {
            let msg = '';
            try {
                const j = await res.json();
                msg = j.message || '';
                const f = j.data ? Object.entries(j.data).map(([k, v]) => `${k}: ${v.message}`).join('; ') : '';
                if (f) msg += ` (${f})`;
            } catch (e) {}
            const err = new Error(msg || ('Error ' + res.status));
            err.status = res.status; // sin status = no se pudo conectar
            err.retryable = isRetryableCloudStatus(res.status);
            throw err;
        }
        return res.status === 204 ? null : await res.json();
    } catch (e) {
        if (e.name === 'AbortError' || e.name === 'TimeoutError') {
            const timeoutErr = new Error('Tiempo de espera agotado al conectar con el servidor');
            timeoutErr.retryable = !options?.signal?.aborted;
            throw timeoutErr;
        }
        if (e.status === undefined && e.retryable === undefined) e.retryable = true;
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

function normalizeServer(v) {
    const LOCAL_HTTP_SERVER = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?(?:\/.*)?$/i;
    v = String(v || '').trim().replace(/\/+$/, '');
    if (!v) return '';
    if (APP_CONFIG.allowLocalHttpServer && LOCAL_HTTP_SERVER.test(v)) {
        const local = new URL(v);
        if (local.username || local.password || local.search || local.hash) {
            throw new Error('La dirección del servidor no es válida.');
        }
        return `${local.origin}${local.pathname}`.replace(/\/+$/, '');
    }
    if (/^http:\/\//i.test(v)) v = v.replace(/^http:/i, 'https:');
    else if (/^[a-z][a-z\d+.-]*:\/\//i.test(v) && !/^https:\/\//i.test(v)) {
        throw new Error('El servidor debe usar HTTPS.');
    } else if (!/^https:\/\//i.test(v)) v = 'https://' + v;

    let url;
    try { url = new URL(v); }
    catch (error) { throw new Error('La dirección del servidor no es válida.'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
        throw new Error('El servidor debe usar una dirección HTTPS válida.');
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}
