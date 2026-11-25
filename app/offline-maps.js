'use strict';

//  MAPAS OFFLINE (teselas IGN guardadas en IndexedDB)
// ============================================================
const OFFLINE_DB = 'mtb_camboya_pro_offline_maps_v1';
const OFFLINE_STORE = 'tiles';
const OFFLINE_META_STORE = 'metadata';
const DOWNLOADED_IGN_STATS_KEY = 'downloadedIgnStats';
const AUTOMATIC_IGN_STORE = 'automatic-ign-tiles';
const ONLINE_TILE_STORE = 'online-tiles';
const MAX_AUTOMATIC_IGN_TILES = 2500;
const MAX_CACHED_ONLINE_TILES = 2500;
// Persistent offline storage for online styles stays disabled until provider terms allow it.
const ONLINE_TILE_OFFLINE_CACHE_ENABLED = false;
const MAX_DOWNLOADED_IGN_TILES = 30000;
const MAX_TILES_PER_DOWNLOAD = 25000;
const OFFLINE_BYTE_LIMIT = typeof MAX_DOWNLOADED_IGN_BYTES !== 'undefined'
    ? MAX_DOWNLOADED_IGN_BYTES
    : 256 * 1024 * 1024;
const OFFLINE_RESERVE_LIMIT = typeof OFFLINE_STORAGE_RESERVE_BYTES !== 'undefined'
    ? OFFLINE_STORAGE_RESERVE_BYTES
    : 128 * 1024 * 1024;
const OFFLINE_STATS_RECONCILE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const IGN_TILE_URL = 'https://tms-mapa-raster.ign.es/1.0.0/mapa-raster/{z}/{x}/{ty}.jpeg';
const MAP_STYLE_NAMES = {
    ign: 'Topográfico IGN',
    topographic: 'Topográfico OpenTopoMap',
    cyclosm: 'CyclOSM (ciclismo)',
    osm: 'OpenStreetMap',
    satellite: 'Satélite Esri'
};
const MAP_STYLE_KEY = 'mtb_pro_map_style';
const DEFAULT_MAP_STYLE = 'topographic';
const MAP_STYLE_TRANSITION_TIMEOUT_MS = 12000;
function selectedMapStyle() {
    let value = null;
    try { value = typeof localStorage !== 'undefined' ? localStorage.getItem(MAP_STYLE_KEY) : null; } catch (e) {}
    return Object.prototype.hasOwnProperty.call(MAP_STYLE_NAMES, value) ? value : DEFAULT_MAP_STYLE;
}
const MAP_RETINA = typeof window !== 'undefined' && window.devicePixelRatio >= 2;
const MAP_TILE_ZOOM_OFFSET = MAP_RETINA ? 1 : 0;
const MAP_TILE_SIZE = MAP_RETINA ? 128 : 256;
const MAP_MAX_ZOOM = 20;
let offlineDbPromise = null;
let stopOfflineDownload = false;
let offlineDownloadRunning = false;
let pendingMapStyleTransition = null;

function offlineMapsUpdateAccessState() {
    const hasAccount = typeof Cloud !== 'undefined' && Cloud.loggedIn();
    const controls = $('offline-download-controls');
    const loginNote = $('offline-login-required');
    if (controls) controls.hidden = !hasAccount;
    if (loginNote) loginNote.hidden = hasAccount;
    if (!hasAccount && offlineDownloadRunning) {
        stopOfflineDownload = true;
        const status = $('offline-storage-note');
        if (status) status.textContent = 'Descarga pausada al cerrar sesión.';
    }
}

function offlineMapsRequireAccount() {
    return requireSignedIn('Inicia sesión o crea una cuenta para descargar mapas sin conexión.');
}

function openOfflineDb() {
    if (offlineDbPromise) return offlineDbPromise;
    offlineDbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('Este navegador no permite almacenamiento offline')); return; }
        const req = indexedDB.open(OFFLINE_DB, 5);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(OFFLINE_STORE)) db.createObjectStore(OFFLINE_STORE, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(OFFLINE_META_STORE)) db.createObjectStore(OFFLINE_META_STORE);
            if (!db.objectStoreNames.contains(AUTOMATIC_IGN_STORE)) {
                const store = db.createObjectStore(AUTOMATIC_IGN_STORE, { keyPath: 'id' });
                store.createIndex('savedAt', 'savedAt');
            }
            if (!db.objectStoreNames.contains(ONLINE_TILE_STORE)) {
                const store = db.createObjectStore(ONLINE_TILE_STORE, { keyPath: 'id' });
                store.createIndex('savedAt', 'savedAt');
            }
        };
        req.onblocked = () => {
            console.warn('La actualización de la base de mapas está bloqueada por otra pestaña.');
            if (typeof toast === 'function') {
                toast('Cierra las otras pestañas de senda-mtb para actualizar los mapas sin conexión.', 7000);
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => {
                db.close();
                offlineDbPromise = null;
            };
            db.onclose = () => {
                offlineDbPromise = null;
            };
            resolve(db);
        };
        req.onerror = () => reject(req.error || new Error('No se pudo abrir el almacenamiento de mapas'));
    });
    offlineDbPromise = offlineDbPromise.catch(error => {
        offlineDbPromise = null;
        throw error;
    });
    return offlineDbPromise;
}

function tileKey(z, x, y) { return `${z}/${x}/${y}`; }
async function getOfflineTile(z, x, y) {
    const db = await openOfflineDb();
    const key = tileKey(z, x, y);
    const read = storeName => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
    return await read(OFFLINE_STORE) || await read(AUTOMATIC_IGN_STORE);
}
async function saveOfflineTile(z, x, y, blob, automatic = false, downloadedByteLimit = OFFLINE_BYTE_LIMIT) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const storeName = automatic ? AUTOMATIC_IGN_STORE : OFFLINE_STORE;
        const tx = automatic
            ? db.transaction(AUTOMATIC_IGN_STORE, 'readwrite')
            : db.transaction([OFFLINE_STORE, AUTOMATIC_IGN_STORE, OFFLINE_META_STORE], 'readwrite');
        const store = tx.objectStore(storeName);
        const id = tileKey(z, x, y);
        let budgetExceeded = false;
        let statsError = null;
        if (automatic) {
            store.put({ id, blob, savedAt: Date.now() });
            const index = store.index('savedAt');
            const count = store.count();
            count.onsuccess = () => {
                let remaining = count.result;
                if (remaining <= MAX_AUTOMATIC_IGN_TILES) return;
                const cursorRequest = index.openCursor();
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor || remaining <= MAX_AUTOMATIC_IGN_TILES) return;
                    cursor.delete();
                    remaining--;
                    cursor.continue();
                };
            };
        } else {
            let oldRecord = null;
            let stats = null;
            let oldRecordReady = false;
            let statsReady = false;
            const writeIfReady = () => {
                if (!oldRecordReady || !statsReady) return;
                if (!stats || !Number.isFinite(stats.bytes) || !Number.isInteger(stats.count)) {
                    statsError = new Error('No se pudo verificar el tamaño acumulado de los mapas.');
                    tx.abort();
                    return;
                }
                const oldBytes = oldRecord && oldRecord.blob instanceof Blob ? oldRecord.blob.size : 0;
                const newBytes = stats.bytes - oldBytes + blob.size;
                if (newBytes > downloadedByteLimit) {
                    budgetExceeded = true;
                    tx.abort();
                    return;
                }
                store.put({ id, blob, savedAt: Date.now() });
                tx.objectStore(AUTOMATIC_IGN_STORE).delete(id);
                tx.objectStore(OFFLINE_META_STORE).put({
                    bytes: newBytes,
                    count: stats.count + (oldRecord ? 0 : 1),
                    reconciledAt: stats.reconciledAt
                }, DOWNLOADED_IGN_STATS_KEY);
            };
            const oldRecordRequest = store.get(id);
            oldRecordRequest.onsuccess = () => {
                oldRecord = oldRecordRequest.result || null;
                oldRecordReady = true;
                writeIfReady();
            };
            const statsRequest = tx.objectStore(OFFLINE_META_STORE).get(DOWNLOADED_IGN_STATS_KEY);
            statsRequest.onsuccess = () => {
                stats = statsRequest.result || null;
                statsReady = true;
                writeIfReady();
            };
            oldRecordRequest.onerror = () => { try { tx.abort(); } catch (e) {} };
            statsRequest.onerror = () => { try { tx.abort(); } catch (e) {} };
        }
        const transactionError = () => budgetExceeded
            ? Object.assign(new Error('Se alcanzó el presupuesto de mapas IGN descargados.'), { code: 'OFFLINE_MAP_BUDGET' })
            : statsError || tx.error || new Error('No se pudo guardar la tesela');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(transactionError());
        tx.onabort = () => reject(transactionError());
    });
}

async function reconcileDownloadedIgnStats() {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([OFFLINE_STORE, OFFLINE_META_STORE], 'readwrite');
        const cursorRequest = tx.objectStore(OFFLINE_STORE).openCursor();
        let bytes = 0;
        let count = 0;
        let stats = null;
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
                const blob = cursor.value && cursor.value.blob;
                if (!(blob instanceof Blob)) {
                    stats = null;
                    try { tx.abort(); } catch (e) {}
                    return;
                }
                bytes += blob.size;
                count++;
                cursor.continue();
                return;
            }
            stats = { bytes, count, reconciledAt: Date.now() };
            tx.objectStore(OFFLINE_META_STORE).put(stats, DOWNLOADED_IGN_STATS_KEY);
        };
        cursorRequest.onerror = () => { try { tx.abort(); } catch (e) {} };
        tx.oncomplete = () => resolve(stats);
        tx.onerror = () => reject(tx.error || new Error('No se pudo reconciliar el tamaño de los mapas'));
        tx.onabort = () => reject(tx.error || new Error('No se pudo reconciliar el tamaño de los mapas'));
    });
}
async function getDownloadedIgnStats() {
    const db = await openOfflineDb();
    const stats = await new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_META_STORE, 'readonly');
        const req = tx.objectStore(OFFLINE_META_STORE).get(DOWNLOADED_IGN_STATS_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('No se pudo leer el tamaño guardado de los mapas'));
    });
    if (!stats || !Number.isFinite(stats.bytes) || !Number.isInteger(stats.count)
        || !Number.isFinite(stats.reconciledAt)
        || Date.now() - stats.reconciledAt >= OFFLINE_STATS_RECONCILE_INTERVAL_MS) {
        return reconcileDownloadedIgnStats();
    }
    return stats;
}
async function countAutomaticIgnTiles() {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(AUTOMATIC_IGN_STORE, 'readonly');
        const req = tx.objectStore(AUTOMATIC_IGN_STORE).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
    });
}
async function countNewDownloadedTiles(tiles) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readonly');
        const req = tx.objectStore(OFFLINE_STORE).getAllKeys();
        let missing = null;
        req.onsuccess = () => {
            const existing = new Set(req.result);
            missing = tiles.reduce((count, tile) => count + (existing.has(tileKey(tile.z, tile.x, tile.y)) ? 0 : 1), 0);
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve(missing);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('No se pudieron comprobar las teselas guardadas'));
    });
}
function onlineTileKey(style, z, x, y) { return `${style}/${z}/${x}/${y}`; }
function formatOnlineTileCacheStatus(count) {
    if (ONLINE_TILE_OFFLINE_CACHE_ENABLED) {
        return `${count.toLocaleString('es-ES')} teselas online en caché`;
    }
    return count
        ? `${count.toLocaleString('es-ES')} teselas online heredadas (inactivas; no se usan sin conexión)`
        : 'caché persistente online desactivada';
}
function isTileProviderRateLimit(error) {
    return Boolean(error && error.status === 429);
}
async function getCachedOnlineTile(style, z, x, y) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ONLINE_TILE_STORE, 'readonly');
        const req = tx.objectStore(ONLINE_TILE_STORE).get(onlineTileKey(style, z, x, y));
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error || new Error('No se pudo leer la tesela online guardada'));
    });
}
async function saveCachedOnlineTile(style, z, x, y, blob) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ONLINE_TILE_STORE, 'readwrite');
        const store = tx.objectStore(ONLINE_TILE_STORE);
        store.put({ id: onlineTileKey(style, z, x, y), blob, savedAt: Date.now() });
        const count = store.count();
        count.onsuccess = () => {
            if (count.result <= MAX_CACHED_ONLINE_TILES) return;
            let remaining = count.result;
            const cursorRequest = store.index('savedAt').openCursor();
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor || remaining <= MAX_CACHED_ONLINE_TILES) return;
                cursor.delete();
                remaining--;
                cursor.continue();
            };
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('No se pudo guardar la tesela online'));
        tx.onabort = () => reject(tx.error || new Error('No se pudo guardar la tesela online'));
    });
}
async function countCachedOnlineTiles() {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ONLINE_TILE_STORE, 'readonly');
        const req = tx.objectStore(ONLINE_TILE_STORE).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error || new Error('No se pudo contar la caché online'));
    });
}
function ignTileUrl(z, x, y) { const tmsY = Math.pow(2, z) - 1 - y; return IGN_TILE_URL.replace('{z}', z).replace('{x}', x).replace('{ty}', tmsY); }
async function fetchAndStoreTile(z, x, y, automatic = false, downloadedByteLimit = OFFLINE_BYTE_LIMIT) {
    const key = tileKey(z, x, y);
    const db = await openOfflineDb();
    const manual = await new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readonly');
        const req = tx.objectStore(OFFLINE_STORE).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
    if (manual) return manual;
    const cached = await new Promise((resolve, reject) => {
        const tx = db.transaction(AUTOMATIC_IGN_STORE, 'readonly');
        const req = tx.objectStore(AUTOMATIC_IGN_STORE).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
    if (cached) {
        if (!automatic) await saveOfflineTile(z, x, y, cached, false, downloadedByteLimit);
        return cached;
    }
    const response = await fetch(ignTileUrl(z, x, y), { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) {
        const error = new Error(`IGN respondió ${response.status}`);
        error.status = response.status;
        throw error;
    }
    const blob = await response.blob();
    if (!blob || !blob.size) throw new Error('Tesela vacía');
    await saveOfflineTile(z, x, y, blob, automatic, downloadedByteLimit);
    return blob;
}

function createOfflineTileLayer() {
    const Layer = L.GridLayer.extend({
        createTile: function(coords, done) {
            const layer = this;
            const tileKey = layer._tileCoordsToKey(coords);
            const img = document.createElement('img');
            img.alt = '';
            img.setAttribute('role', 'presentation');
            const tileSize = this.getTileSize().x;
            const sourceCoords = { ...coords, z: coords.z + MAP_TILE_ZOOM_OFFSET };
            img.style.width = `${tileSize}px`;
            img.style.height = `${tileSize}px`;
            let finished = false;
            const finish = err => {
                if (finished) return;
                finished = true;
                const currentTile = layer._tiles && layer._tiles[tileKey];
                if (!layer._map || !currentTile || currentTile.el !== img) return;
                done(err, img);
            };
            (async () => {
                try {
                    const blob = await getOfflineTile(sourceCoords.z, sourceCoords.x, sourceCoords.y);
                    if (blob) {
                        const objectUrl = URL.createObjectURL(blob);
                        img.onload = () => { URL.revokeObjectURL(objectUrl); finish(null); };
                        img.onerror = () => { URL.revokeObjectURL(objectUrl); finish(new Error('Error mostrando mapa guardado')); };
                        img.src = objectUrl;
                        return;
                    }
                    const response = await fetch(ignTileUrl(sourceCoords.z, sourceCoords.x, sourceCoords.y), { mode: 'cors' });
                    if (!response.ok) throw new Error('Tesela no disponible');
                    const blobOnline = await response.blob();
                    // Guarda automáticamente las teselas que se van viendo, además de las descargadas manualmente.
                    saveOfflineTile(sourceCoords.z, sourceCoords.x, sourceCoords.y, blobOnline, true).catch(error => {
                        console.warn('No se pudo guardar la tesela IGN en caché:', error);
                    });
                    const objectUrl = URL.createObjectURL(blobOnline);
                    img.onload = () => { URL.revokeObjectURL(objectUrl); finish(null); };
                    img.onerror = () => { URL.revokeObjectURL(objectUrl); finish(new Error('Error mostrando mapa')); };
                    img.src = objectUrl;
                } catch (err) {
                    // Último intento directo: permite ver el mapa si el servidor admite la carga como imagen.
                    img.onload = () => finish(null);
                    img.onerror = () => finish(err);
                    img.src = ignTileUrl(sourceCoords.z, sourceCoords.x, sourceCoords.y);
                }
            })();
            return img;
        }
    });
    return new Layer({
        tileSize: MAP_TILE_SIZE,
        minZoom: 5,
        maxZoom: MAP_MAX_ZOOM,
        maxNativeZoom: 17 - MAP_TILE_ZOOM_OFFSET,
        attribution: 'Cartografía: © Instituto Geográfico Nacional (IGN), CC BY 4.0'
    });
}

function createCachedOnlineTileLayer(style, urlTemplate, options) {
    const Layer = L.GridLayer.extend({
        createTile: function(coords, done) {
            const layer = this;
            const tileKey = layer._tileCoordsToKey(coords);
            const tile = document.createElement('div');
            const img = document.createElement('img');
            img.alt = '';
            img.setAttribute('role', 'presentation');
            const tileSize = this.getTileSize().x;
            const sourceCoords = { ...coords, z: coords.z + MAP_TILE_ZOOM_OFFSET };
            tile.style.width = `${tileSize}px`;
            tile.style.height = `${tileSize}px`;
            tile.style.position = 'absolute';
            tile.style.overflow = 'hidden';
            img.style.position = 'absolute';
            tile.appendChild(img);
            let finished = false;
            const finish = err => {
                if (finished) return;
                finished = true;
                const currentTile = layer._tiles && layer._tiles[tileKey];
                if (!layer._map || !currentTile || currentTile.el !== tile) return;
                done(err, tile);
            };
            const showBlob = (blob, sourceZoom = sourceCoords.z, sourceX = sourceCoords.x, sourceY = sourceCoords.y) => {
                const scale = Math.pow(2, Math.max(0, sourceCoords.z - sourceZoom));
                const sourceTileSize = tileSize * scale;
                img.style.width = `${sourceTileSize}px`;
                img.style.height = `${sourceTileSize}px`;
                img.style.left = `${-(sourceCoords.x % scale) * tileSize}px`;
                img.style.top = `${-(sourceCoords.y % scale) * tileSize}px`;
                const objectUrl = URL.createObjectURL(blob);
                img.onload = () => { URL.revokeObjectURL(objectUrl); finish(null); };
                img.onerror = () => { URL.revokeObjectURL(objectUrl); finish(new Error('Error mostrando tesela guardada')); };
                img.src = objectUrl;
            };
            const tileUrl = L.Util.template(urlTemplate, {
                ...sourceCoords,
                s: options.subdomains[(sourceCoords.x + sourceCoords.y) % options.subdomains.length]
            });
            const findCachedAncestor = async (readTile, minZoom = 5, includeExact = false) => {
                for (let zoom = sourceCoords.z - (includeExact ? 0 : 1); zoom >= minZoom; zoom--) {
                    const scale = Math.pow(2, sourceCoords.z - zoom);
                    const x = Math.floor(sourceCoords.x / scale);
                    const y = Math.floor(sourceCoords.y / scale);
                    const blob = await readTile(zoom, x, y);
                    if (blob) return { blob, zoom, x, y };
                }
                return null;
            };
            const fallbackToCachedStyle = async () => {
                if (!ONLINE_TILE_OFFLINE_CACHE_ENABLED) return false;
                try {
                    const ancestor = await findCachedAncestor((zoom, x, y) =>
                        getCachedOnlineTile(style, zoom, x, y)
                    );
                    if (ancestor) {
                        showBlob(ancestor.blob, ancestor.zoom, ancestor.x, ancestor.y);
                        return true;
                    }
                } catch (error) {
                    console.warn(`No se pudo leer una tesela anterior de ${style}:`, error);
                }
                return false;
            };
            const fallbackToIgn = async () => {
                try {
                    const ancestor = await findCachedAncestor(
                        (zoom, x, y) => zoom <= 17 ? getOfflineTile(zoom, x, y) : Promise.resolve(null),
                        5,
                        true
                    );
                    if (ancestor) {
                        showBlob(ancestor.blob, ancestor.zoom, ancestor.x, ancestor.y);
                        return;
                    }
                    if (navigator.onLine) {
                        // El servidor del estilo falla: se muestra el IGN en directo en lugar de dejar el mapa vacío.
                        const igZoom = Math.min(sourceCoords.z, 17);
                        const scale = Math.pow(2, sourceCoords.z - igZoom);
                        const igX = Math.floor(sourceCoords.x / scale), igY = Math.floor(sourceCoords.y / scale);
                        const blob = await fetchAndStoreTile(igZoom, igX, igY, true);
                        showBlob(blob, igZoom, igX, igY);
                        return;
                    }
                    finish(new Error('No hay tesela online ni mapa IGN guardado para esta zona.'));
                } catch (error) {
                    console.warn('No se pudo leer el mapa IGN de respaldo:', error);
                    finish(error);
                }
            };
            const fetchAndCache = async () => {
                const response = await fetch(tileUrl, { mode: 'cors' });
                if (!response.ok) throw new Error(`El servidor de mapas respondió ${response.status}`);
                const blob = await response.blob();
                if (!blob.size) throw new Error('El servidor de mapas devolvió una tesela vacía');
                if (ONLINE_TILE_OFFLINE_CACHE_ENABLED) {
                    await saveCachedOnlineTile(style, sourceCoords.z, sourceCoords.x, sourceCoords.y, blob).catch(error => {
                        console.warn(`No se pudo guardar la tesela ${style} en caché:`, error);
                    });
                }
                return blob;
            };
            (async () => {
                let cached = null;
                if (ONLINE_TILE_OFFLINE_CACHE_ENABLED) {
                    try {
                        cached = await getCachedOnlineTile(style, sourceCoords.z, sourceCoords.x, sourceCoords.y);
                    } catch (error) {
                        console.warn(`No se pudo leer la caché ${style}:`, error);
                    }
                }
                if (cached) {
                    showBlob(cached);
                    if (navigator.onLine) fetchAndCache().catch(() => {});
                    return;
                }
                if (!navigator.onLine) {
                    if (await fallbackToCachedStyle()) return;
                    await fallbackToIgn();
                    return;
                }
                try {
                    showBlob(await fetchAndCache());
                } catch (error) {
                    img.style.width = `${tileSize}px`;
                    img.style.height = `${tileSize}px`;
                    img.style.left = '0';
                    img.style.top = '0';
                    img.onload = () => finish(null);
                    img.onerror = async () => {
                        if (await fallbackToCachedStyle()) return;
                        await fallbackToIgn();
                    };
                    img.src = tileUrl;
                }
            })();
            return tile;
        }
    });
    const sourceMaxZoom = options.maxNativeZoom;
    return new Layer({
        tileSize: MAP_TILE_SIZE,
        ...options,
        maxZoom: MAP_MAX_ZOOM,
        maxNativeZoom: sourceMaxZoom - MAP_TILE_ZOOM_OFFSET,
        attribution: `${options.attribution} | Teselas offline de respaldo: © Instituto Geográfico Nacional (IGN), CC BY 4.0`
    });
}

function createMapStyleLayer(style) {
    const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    const styles = {
        topographic: {
            url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
            options: {
                maxNativeZoom: 17, subdomains: ['a', 'b', 'c'],
                attribution: `${osmAttribution}, SRTM | style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`
            }
        },
        cyclosm: {
            url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
            options: {
                maxNativeZoom: 19, subdomains: ['a', 'b', 'c'],
                attribution: `${osmAttribution} | style: <a href="https://www.cyclosm.org">CyclOSM</a>`
            }
        },
        osm: {
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            options: {
                maxNativeZoom: 19, subdomains: ['a'],
                attribution: osmAttribution
            }
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            options: {
                maxNativeZoom: 19, subdomains: ['a'],
                attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
            }
        }
    };
    const definition = styles[style];
    if (!definition) throw new RangeError(`Estilo de mapa desconocido: ${style}`);
    return createCachedOnlineTileLayer(style, definition.url, definition.options);
}

function createMapStyleLayers() {
    return {
        ign: offlineTileLayer,
        topographic: createMapStyleLayer('topographic'),
        cyclosm: createMapStyleLayer('cyclosm'),
        osm: createMapStyleLayer('osm'),
        satellite: createMapStyleLayer('satellite')
    };
}

function applyMapStyle() {
    if (!map || !mapStyleLayers.ign) return;
    const chosen = selectedMapStyle();
    const style = navigator.onLine ? chosen : 'ign';
    if (!activeMapStyle) {
        mapStyleLayers.ign.addTo(map);
        activeMapStyle = 'ign';
    }
    if (pendingMapStyleTransition) {
        const pending = pendingMapStyleTransition;
        clearTimeout(pending.timer);
        pending.layer.off('load', pending.onLoad);
        pending.layer.off('tileload', pending.onTileLoad);
        pending.layer.off('tileerror', pending.onTileError);
        if (map.hasLayer(pending.layer)) map.removeLayer(pending.layer);
        pendingMapStyleTransition = null;
    }
    if (activeMapStyle !== style) {
        const layer = mapStyleLayers[style];
        const transition = {
            layer,
            tileLoads: 0,
            tileErrors: 0,
            timer: null,
            onTileLoad: () => { transition.tileLoads++; },
            onTileError: () => { transition.tileErrors++; },
            onLoad: null
        };
        const finishTransition = useNewLayer => {
            if (pendingMapStyleTransition !== transition) return;
            clearTimeout(transition.timer);
            layer.off('load', transition.onLoad);
            layer.off('tileload', transition.onTileLoad);
            layer.off('tileerror', transition.onTileError);
            if (useNewLayer) {
                if (mapStyleLayers[activeMapStyle] && map.hasLayer(mapStyleLayers[activeMapStyle])) {
                    map.removeLayer(mapStyleLayers[activeMapStyle]);
                }
                activeMapStyle = style;
            } else if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
            pendingMapStyleTransition = null;
            updateQuickMapStyleButton();
        };
        transition.onLoad = () => finishTransition(transition.tileLoads > 0 && transition.tileErrors === 0);
        pendingMapStyleTransition = transition;
        layer.on('load', transition.onLoad);
        layer.on('tileload', transition.onTileLoad);
        layer.on('tileerror', transition.onTileError);
        transition.timer = setTimeout(() => finishTransition(false), MAP_STYLE_TRANSITION_TIMEOUT_MS);
        layer.addTo(map);
    }
    const status = $('map-style-status');
    if (!status) return;
    const retinaText = MAP_RETINA ? ' En pantallas de alta densidad se cargan teselas un nivel más detalladas.' : '';
    if (style === 'ign') {
        status.textContent = navigator.onLine
            ? `${MAP_STYLE_NAMES.ign} con las teselas descargadas. Cartografía nativa hasta zoom 17; por encima se amplía la imagen.${retinaText}`
            : `Sin conexión: ${MAP_STYLE_NAMES.ign} y teselas guardadas. Cartografía nativa hasta zoom 17; por encima se amplía la imagen.${retinaText}`;
    } else {
        status.textContent = `${MAP_STYLE_NAMES[style]} se muestra online. Para uso sin conexión se utiliza ${MAP_STYLE_NAMES.ign} y las zonas descargadas desde Mapas offline.${retinaText}`;
    }
}

function updateQuickMapStyleButton() {
    const button = $('btn-map-style');
    if (!button) return;
    const style = !navigator.onLine ? 'ign' : activeMapStyle || selectedMapStyle();
    const icons = {
        ign: '🗺️',
        topographic: '⛰️',
        cyclosm: '🚵',
        osm: '🌍',
        satellite: '🛰️'
    };
    const name = MAP_STYLE_NAMES[style] || MAP_STYLE_NAMES[DEFAULT_MAP_STYLE];
    button.textContent = icons[style] || '🗺️';
    button.title = `Capa actual: ${name}. Pulsa para cambiar.`;
    button.setAttribute('aria-label', `Capa actual: ${name}. Pulsa para cambiar el mapa.`);
}

// Rectángulos geográficos para descargar mapas offline por comunidad o región.
const REGION_BOUNDS = {
    andalucia: [{ west: -7.55, east: -1.60, south: 35.90, north: 38.75 }],
    aragon: [{ west: -1.80, east: 0.80, south: 39.80, north: 42.95 }],
    asturias: [{ west: -7.20, east: -4.50, south: 43.10, north: 43.70 }],
    baleares: [{ west: 1.15, east: 4.35, south: 38.60, north: 40.10 }],
    canarias: [{ west: -18.20, east: -13.30, south: 27.60, north: 29.50 }],
    cantabria: [{ west: -4.90, east: -3.10, south: 43.00, north: 43.65 }],
    'castilla-la-mancha': [{ west: -5.40, east: -1.30, south: 38.00, north: 41.35 }],
    'castilla-y-leon': [{ west: -7.10, east: -1.75, south: 40.00, north: 43.30 }],
    cataluna: [{ west: 0.15, east: 3.35, south: 40.50, north: 42.90 }],
    'comunidad-valenciana': [{ west: -1.55, east: 0.55, south: 37.80, north: 40.80 }],
    extremadura: [{ west: -7.55, east: -4.50, south: 37.90, north: 40.50 }],
    galicia: [{ west: -9.30, east: -6.70, south: 41.80, north: 43.85 }],
    madrid: [{ west: -4.60, east: -3.00, south: 39.90, north: 41.20 }],
    murcia: [{ west: -2.40, east: -0.50, south: 37.35, north: 38.80 }],
    navarra: [{ west: -2.60, east: -0.70, south: 41.90, north: 43.30 }],
    'pais-vasco': [{ west: -3.50, east: -1.70, south: 42.40, north: 43.50 }],
    'la-rioja': [{ west: -3.20, east: -1.60, south: 41.90, north: 42.70 }],
    portugal: [{ west: -9.55, east: -6.18, south: 36.95, north: 42.15 }]
};

function estimateRegionTileCount(region, maxZoom) {
    const areas = REGION_BOUNDS[region];
    if (!areas) return null;
    const xt = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
    const yt = (lat, z) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
    const out = new Set();
    for (let z = 7; z <= maxZoom; z++) {
        for (const { west, east, south, north } of areas) {
            const x1 = xt(west, z), x2 = xt(east, z), y1 = yt(north, z), y2 = yt(south, z);
            for (let x = x1; x <= x2; x++) {
                for (let y = y1; y <= y2; y++) out.add(`${z}/${x}/${y}`);
            }
        }
    }
    return out.size;
}

function regionTiles(region, maxZoom) {
    const areas = REGION_BOUNDS[region];
    if (!areas) throw new Error('La comunidad seleccionada no tiene un área de descarga definida.');
    const out = new Map();
    const xt = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
    const yt = (lat, z) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
    for (let z = 7; z <= maxZoom; z++) {
        for (const { west, east, south, north } of areas) {
            const x1 = xt(west, z), x2 = xt(east, z), y1 = yt(north, z), y2 = yt(south, z);
            for (let x = x1; x <= x2; x++) {
                for (let y = y1; y <= y2; y++) {
                    out.set(`${z}/${x}/${y}`, { z, x, y });
                    if (out.size > MAX_TILES_PER_DOWNLOAD) {
                        throw new Error(`La selección supera el límite de ${MAX_TILES_PER_DOWNLOAD.toLocaleString('es-ES')} teselas por descarga. Elige nivel de detalle estándar (zoom 7–13) o una zona más pequeña.`);
                    }
                }
            }
        }
    }
    return [...out.values()];
}

function visibleDetailTiles(bounds, minZoom = 15, maxZoom = 17) {
    const west = bounds.getWest(), east = bounds.getEast();
    const south = Math.max(-85.05112878, bounds.getSouth());
    const north = Math.min(85.05112878, bounds.getNorth());
    const tileX = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
    const tileY = (lat, z) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
    const tiles = new Map();
    for (let z = minZoom; z <= maxZoom; z++) {
        const n = Math.pow(2, z);
        const x1 = Math.max(0, Math.min(n - 1, tileX(west, z)));
        const x2 = Math.max(0, Math.min(n - 1, tileX(east, z)));
        const y1 = Math.max(0, Math.min(n - 1, tileY(north, z)));
        const y2 = Math.max(0, Math.min(n - 1, tileY(south, z)));
        const candidateCount = (x2 - x1 + 1) * (y2 - y1 + 1);
        if (tiles.size + candidateCount > MAX_TILES_PER_DOWNLOAD) {
            throw new Error(`La vista actual supera el límite de ${MAX_TILES_PER_DOWNLOAD.toLocaleString('es-ES')} teselas. Acércate al área que quieres guardar.`);
        }
        for (let x = x1; x <= x2; x++) {
            for (let y = y1; y <= y2; y++) tiles.set(`${z}/${x}/${y}`, { z, x, y });
        }
    }
    return [...tiles.values()];
}

function formatOfflineBytes(bytes) {
    return `${(bytes / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MiB`;
}

async function downloadedIgnBudget(stats) {
    let limitBytes = OFFLINE_BYTE_LIMIT;
    let note = '';
    if (navigator.storage && navigator.storage.estimate) {
        try {
            const estimate = await navigator.storage.estimate();
            if (Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)) {
                const availableBytes = Math.max(0, estimate.quota - estimate.usage - OFFLINE_RESERVE_LIMIT);
                limitBytes = Math.min(limitBytes, stats.bytes + availableBytes);
                note = ` La cuota del dispositivo deja ${formatOfflineBytes(availableBytes)} para mapas tras reservar ${formatOfflineBytes(OFFLINE_RESERVE_LIMIT)} para el resto de datos y cachés.`;
            }
        } catch (error) {
            console.warn('No se pudo estimar el espacio de mapas offline:', error);
        }
    }
    return { limitBytes, availableBytes: Math.max(0, limitBytes - stats.bytes), note };
}

function setOfflineProgress(done, total, errors, stats = null) {
    const pct = total ? Math.round(done / total * 100) : 0;
    $('offline-progress-fill').style.width = pct + '%';
    const storage = stats ? ` · ${formatOfflineBytes(stats.bytes)} / ${formatOfflineBytes(OFFLINE_BYTE_LIMIT)}` : '';
    $('offline-progress-text').textContent = `${done.toLocaleString('es-ES')} / ${total.toLocaleString('es-ES')} teselas (${pct}%)${errors ? ` · ${errors} errores` : ''}${storage}`;
}
async function downloadRegionOffline() {
    if (!offlineMapsRequireAccount()) return;
    if (offlineDownloadRunning) return;
    const regionSelect = $('offline-region');
    const region = regionSelect.value;
    const regionName = regionSelect.options[regionSelect.selectedIndex].text;
    const maxZoom = Number($('offline-detail').value) || 13;
    let tiles;
    try { tiles = regionTiles(region, maxZoom); }
    catch (error) { toast(error.message, 7000); return; }
    const detailName = maxZoom === 14 ? 'alto (zoom 7–14)' : 'estándar (zoom 7–13)';
    return downloadTileSetOffline(tiles, regionName, detailName, $('btn-download-region'));
}

async function downloadVisibleDetailOffline() {
    if (!offlineMapsRequireAccount()) return;
    if (offlineDownloadRunning) return;
    if (!map) { toast('El mapa todavía no está listo.'); return; }
    let tiles;
    try { tiles = visibleDetailTiles(map.getBounds()); }
    catch (error) { toast(error.message, 7000); return; }
    return downloadTileSetOffline(tiles, 'zona visible del mapa', 'detalle alto (zoom 15–17)', $('btn-download-visible-detail'));
}

async function downloadTileSetOffline(tiles, regionName, detailName, downloadButton) {
    if (!offlineMapsRequireAccount()) return;
    if (offlineDownloadRunning) return;
    if (!tiles.length) { toast('No hay teselas en el área seleccionada.'); return; }
    if (tiles.length > MAX_TILES_PER_DOWNLOAD) {
        toast(`La selección supera el límite de ${MAX_TILES_PER_DOWNLOAD.toLocaleString('es-ES')} teselas por descarga. Elige menos detalle o una región más pequeña.`, 7000);
        return;
    }
    let newTiles, downloadedStats;
    try {
        [downloadedStats, newTiles] = await Promise.all([getDownloadedIgnStats(), countNewDownloadedTiles(tiles)]);
        if (downloadedStats.count + newTiles > MAX_DOWNLOADED_IGN_TILES) {
            toast(`La descarga superaría el límite de ${MAX_DOWNLOADED_IGN_TILES.toLocaleString('es-ES')} teselas IGN descargadas. Borra mapas antiguos o elige menos detalle.`, 7000);
            return;
        }
    } catch (error) {
        console.warn('No se pudo comprobar el espacio de mapas offline:', error);
        toast('No se pudo comprobar el almacenamiento de mapas. Inténtalo de nuevo.', 6000);
        return;
    }
    const budget = await downloadedIgnBudget(downloadedStats);
    if (newTiles && !budget.availableBytes) {
        toast(`No queda espacio en el presupuesto de mapas IGN (${formatOfflineBytes(downloadedStats.bytes)} de ${formatOfflineBytes(budget.limitBytes)}). Quedan ${newTiles.toLocaleString('es-ES')} teselas de esta selección sin guardar.`, 7000);
        return;
    }
    const averageTileBytes = downloadedStats.count ? downloadedStats.bytes / downloadedStats.count : 0;
    const estimatedFit = averageTileBytes > 0
        ? Math.min(newTiles, Math.floor(budget.availableBytes / averageTileBytes))
        : null;
    const measuredSizeNote = estimatedFit === null
        ? ' Aún no hay un tamaño medio medido para estimar cuántas cabrán; se aplicará el límite al tamaño real de cada tesela.'
        : ` El tamaño medio real actual es ${formatOfflineBytes(averageTileBytes)} por tesela; cabrían aproximadamente ${estimatedFit.toLocaleString('es-ES')} de las ${newTiles.toLocaleString('es-ES')} nuevas.`;
    const storageNote = ` Hay ${formatOfflineBytes(downloadedStats.bytes)} de ${formatOfflineBytes(MAX_DOWNLOADED_IGN_BYTES)} ocupados; quedan ${formatOfflineBytes(budget.availableBytes)} disponibles.${budget.note}${measuredSizeNote}`;
    const confirmed = await modal({
        message: `Se incorporarán hasta ${newTiles.toLocaleString('es-ES')} teselas IGN al mapa descargado de ${regionName} con detalle ${detailName}.${storageNote} Usa Wi-Fi y mantén la aplicación abierta. Las teselas descargadas se omiten y las de caché se reutilizan.`,
        ok: 'Descargar'
    });
    if (!confirmed || !offlineMapsRequireAccount()) return;
    offlineDownloadRunning = true; stopOfflineDownload = false;
    let done = 0, errors = 0, cursor = 0, budgetReached = false, quotaReached = false;
    let providerRateLimited = false;
    downloadButton.disabled = true;
    $('offline-storage-note').textContent = `Descargando ${regionName}. Mantén la app abierta y conectada a Wi-Fi. Si la paras, repite la descarga para la misma región o vuelve a encuadrar la misma zona; las teselas ya guardadas se conservan.`;
    setOfflineProgress(0, tiles.length, 0, downloadedStats);
    try {
        await openOfflineDb();
        const workers = Array.from({ length: 3 }, async () => {
            while (!stopOfflineDownload && !budgetReached && !providerRateLimited) {
                const i = cursor++;
                if (i >= tiles.length) break;
                const t = tiles[i];
                try {
                    await fetchAndStoreTile(t.z, t.x, t.y, false, budget.limitBytes);
                } catch (error) {
                    if (error.code === 'OFFLINE_MAP_BUDGET' || error.name === 'QuotaExceededError') {
                        budgetReached = true;
                        quotaReached = error.name === 'QuotaExceededError';
                    } else if (isTileProviderRateLimit(error)) {
                        providerRateLimited = true;
                        errors++;
                        console.warn('IGN limitó temporalmente las solicitudes; se detiene la descarga.');
                    } else {
                        errors++;
                        console.warn('No se pudo descargar tesela', t, error);
                    }
                }
                done++;
                if (done % 10 === 0 || done === tiles.length || budgetReached || providerRateLimited) {
                    const stats = await getDownloadedIgnStats();
                    setOfflineProgress(done, tiles.length, errors, stats);
                }
            }
        });
        await Promise.all(workers);
        const [stored, automatic] = await Promise.all([getDownloadedIgnStats(), countAutomaticIgnTiles()]);
        if (stopOfflineDownload) {
            $('offline-progress-text').textContent += ' · Pausado';
            toast('Descarga pausada. Puedes reanudarla más tarde.');
        } else if (providerRateLimited) {
            const remaining = await countNewDownloadedTiles(tiles);
            $('offline-progress-text').textContent += ' · Límite del proveedor';
            $('offline-storage-note').textContent = `IGN respondió HTTP 429 y limitó temporalmente las solicitudes. Se guardaron ${stored.count.toLocaleString('es-ES')} teselas (${formatOfflineBytes(stored.bytes)}). Quedan ${remaining.toLocaleString('es-ES')} teselas sin guardar. Espera antes de volver a intentarlo.`;
            toast('IGN limitó temporalmente las solicitudes. Descarga detenida; inténtalo más tarde.', 8000);
        } else if (budgetReached) {
            const remaining = await countNewDownloadedTiles(tiles);
            const remainingCapacity = Math.max(0, budget.limitBytes - stored.bytes);
            const fitRemaining = stored.count ? Math.floor(remainingCapacity / (stored.bytes / stored.count)) : null;
            const reason = quotaReached ? 'la cuota disponible del dispositivo' : 'el presupuesto configurado';
            const capacityText = fitRemaining === null
                ? ''
                : ` El tamaño medio real actual permitiría aproximadamente ${fitRemaining.toLocaleString('es-ES')} teselas más.`;
            $('offline-progress-text').textContent += ' · Presupuesto alcanzado';
            $('offline-storage-note').textContent = `La descarga se detuvo al alcanzar ${reason}. Se guardaron ${stored.count.toLocaleString('es-ES')} teselas (${formatOfflineBytes(stored.bytes)}). Quedan ${remaining.toLocaleString('es-ES')} teselas de esta selección sin guardar.${capacityText} Puedes borrar mapas o reanudar cuando haya más espacio.`;
            toast(`Descarga detenida: quedan ${remaining.toLocaleString('es-ES')} teselas sin guardar`, 7000);
        } else {
            setOfflineProgress(done, tiles.length, errors, stored);
            $('offline-storage-note').textContent = `Proceso terminado. Teselas IGN descargadas: ${stored.count.toLocaleString('es-ES')} (${formatOfflineBytes(stored.bytes)} de ${formatOfflineBytes(MAX_DOWNLOADED_IGN_BYTES)}); caché IGN automática: ${automatic.toLocaleString('es-ES')}. La caché persistente de estilos online está desactivada; cualquier tesela online antigua permanece inactiva y se elimina con «Borrar mapas». Los datos guardados consumen cuota del dispositivo. Los errores se pueden reintentar volviendo a pulsar descargar.`;
            toast(errors ? `Mapa descargado con ${errors} teselas pendientes` : `Mapa de ${regionName} guardado para usar sin conexión`, 5000);
        }
    } catch (e) {
        console.error(e);
        $('offline-storage-note').textContent = 'No se pudo iniciar el almacenamiento offline: ' + (e.message || e);
        toast('No se pudo iniciar la descarga de mapas', 5000);
    } finally {
        offlineDownloadRunning = false;
        downloadButton.disabled = false;
    }
}
function updateOfflineEstimateUI() {
    const regionSelect = $('offline-region');
    const detailSelect = $('offline-detail');
    const estimateInfo = $('offline-estimate-info');
    const downloadBtn = $('btn-download-region');
    if (!regionSelect || !detailSelect || !estimateInfo) return;

    const region = regionSelect.value;
    const maxZoom = Number(detailSelect.value) || 13;
    const count = estimateRegionTileCount(region, maxZoom);

    if (count === null) {
        estimateInfo.textContent = 'Selecciona una región válida.';
        estimateInfo.style.color = '#ff6b6b';
        if (downloadBtn) downloadBtn.disabled = true;
        return;
    }

    if (count > MAX_TILES_PER_DOWNLOAD) {
        estimateInfo.innerHTML = `⚠️ <strong>Límite excedido:</strong> ~${count.toLocaleString('es-ES')} teselas estimadas (máx. ${MAX_TILES_PER_DOWNLOAD.toLocaleString('es-ES')}). Te recomendamos detalle estándar (zoom 7–13) o descargar solo la vista visible.`;
        estimateInfo.style.color = '#ffaa44';
        if (downloadBtn && !offlineDownloadRunning) {
            downloadBtn.disabled = true;
            downloadBtn.title = 'Límite de teselas por descarga excedido para esta combinación';
        }
    } else {
        const estBytes = count * 9200; // ~9 KB de promedio real por tesela IGN
        estimateInfo.innerHTML = `Estimación: <strong>${count.toLocaleString('es-ES')} teselas</strong> (~${formatOfflineBytes(estBytes)}) para esta región.`;
        estimateInfo.style.color = '#00B8FF';
        if (downloadBtn && !offlineDownloadRunning) {
            downloadBtn.disabled = false;
            downloadBtn.removeAttribute('title');
        }
    }
}

async function openOfflineMaps() {
    updateOfflineEstimateUI();
    // Actualiza el espacio local al abrir Mapas sin conexión en el centro de control.
    try {
        const [stats, automaticCount, onlineCount] = await Promise.all([
            getDownloadedIgnStats(), countAutomaticIgnTiles(), countCachedOnlineTiles()
        ]);
        const budget = await downloadedIgnBudget(stats);
        let usado = '';
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                usado = ` Espacio usado por la app: ${Math.round((est.usage || 0) / 1048576)} MB.`;
            }
        } catch (error) { console.warn('No se pudo estimar el espacio usado:', error); }
        $('offline-storage-note').textContent = `${stats.count.toLocaleString('es-ES')} teselas IGN descargadas (${formatOfflineBytes(stats.bytes)} de ${formatOfflineBytes(MAX_DOWNLOADED_IGN_BYTES)}; quedan ${formatOfflineBytes(budget.availableBytes)} disponibles), ${automaticCount.toLocaleString('es-ES')} de caché IGN automática y ${formatOnlineTileCacheStatus(onlineCount)}.${budget.note}${usado} El presupuesto limita los mapas IGN descargados. Las teselas IGN automáticas y las teselas online heredadas también consumen cuota del dispositivo; puedes eliminarlas con «Borrar mapas». Puedes reanudar una descarga incompleta.`;
    } catch (e) {
        console.warn('No se pudieron cargar los mapas offline:', e);
        $('offline-storage-note').textContent = 'El almacenamiento local aún no está inicializado.';
    }
}

async function clearOfflineTiles() {
    if (offlineDownloadRunning) {
        toast('Pausa la descarga antes de borrar los mapas guardados.');
        return;
    }
    const confirmed = await modal({
        message: '¿Borrar los mapas descargados y las teselas de mapa guardadas en este dispositivo?',
        ok: 'Borrar mapas'
    });
    if (!confirmed) return;

    try {
        const db = await openOfflineDb();
        await new Promise((resolve, reject) => {
            const stores = [OFFLINE_STORE, OFFLINE_META_STORE, AUTOMATIC_IGN_STORE, ONLINE_TILE_STORE];
            const tx = db.transaction(stores, 'readwrite');
            stores.forEach(name => tx.objectStore(name).clear());
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error('No se pudieron borrar los mapas guardados.'));
            tx.onabort = () => reject(tx.error || new Error('No se pudieron borrar los mapas guardados.'));
        });
    } catch (error) {
        console.error('No se pudieron borrar los mapas guardados:', error);
        toast('No se pudieron borrar los mapas guardados.', 5000);
        return;
    }

    toast('Mapas guardados borrados.');
    await openOfflineMaps();
}

if (typeof $ === 'function') {
    $('btn-download-region')?.addEventListener('click', downloadRegionOffline);
    $('btn-download-visible-detail')?.addEventListener('click', downloadVisibleDetailOffline);
    $('btn-cancel-download')?.addEventListener('click', () => { stopOfflineDownload = true; $('offline-storage-note').textContent = 'Parando la descarga…'; });
    $('offline-region')?.addEventListener('change', updateOfflineEstimateUI);
    $('offline-detail')?.addEventListener('change', updateOfflineEstimateUI);
    updateOfflineEstimateUI();
    $('btn-clear-offline')?.addEventListener('click', clearOfflineTiles);

    const mapStyleSelect = $('map-style-select');
    if (mapStyleSelect) {
        mapStyleSelect.value = selectedMapStyle();
        mapStyleSelect.addEventListener('change', () => {
            try { localStorage.setItem(MAP_STYLE_KEY, mapStyleSelect.value); }
            catch (e) { console.warn('No se pudo guardar el mapa elegido:', e); }
            if (typeof queueCloudPreferencesSync === 'function') queueCloudPreferencesSync();
            applyMapStyle();
            updateQuickMapStyleButton();
        });
    }
    $('btn-map-style')?.addEventListener('click', () => {
        const styles = Object.keys(MAP_STYLE_NAMES);
        const next = styles[(styles.indexOf(selectedMapStyle()) + 1) % styles.length];
        if (mapStyleSelect) {
            mapStyleSelect.value = next;
            mapStyleSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });
    updateQuickMapStyleButton();
    offlineMapsUpdateAccessState();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        REGION_BOUNDS,
        regionTiles,
        visibleDetailTiles,
        estimateRegionTileCount,
        formatOfflineBytes,
        MAX_DOWNLOADED_IGN_BYTES: OFFLINE_BYTE_LIMIT,
        OFFLINE_STORAGE_RESERVE_BYTES: OFFLINE_RESERVE_LIMIT,
        MAX_DOWNLOADED_IGN_TILES,
        MAX_TILES_PER_DOWNLOAD,
        ONLINE_TILE_OFFLINE_CACHE_ENABLED,
        formatOnlineTileCacheStatus,
        isTileProviderRateLimit,
        ignTileUrl,
        tileKey,
        onlineTileKey
    };
}


// ============================================================
