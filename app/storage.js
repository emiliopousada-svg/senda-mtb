'use strict';

//  ALMACENAMIENTO (IndexedDB)
// ============================================================
const ROUTE_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const DB = {
    db: null,
    open() {
        return new Promise((res, rej) => {
            if (!window.indexedDB) return rej(new Error('no-idb'));
            const r = indexedDB.open('mtb_camboya_pro_db', 2);
            r.onupgradeneeded = event => {
                const d = r.result;
                if (!d.objectStoreNames.contains('routes')) d.createObjectStore('routes', { keyPath: 'id' });
                if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
                const photos = d.objectStoreNames.contains('routePhotos')
                    ? event.target.transaction.objectStore('routePhotos')
                    : d.createObjectStore('routePhotos', { keyPath: 'routeId' });

                // Move photo blobs out of route records so startup doesn't retain every image in RAM.
                if (event.oldVersion > 0 && event.oldVersion < 2) {
                    const routes = event.target.transaction.objectStore('routes');
                    const cursorRequest = routes.openCursor();
                    cursorRequest.onsuccess = cursorEvent => {
                        const cursor = cursorEvent.target.result;
                        if (!cursor) return;
                        const route = cursor.value;
                        const savedPhotos = [];
                        if (Array.isArray(route.pois)) {
                            route.pois = route.pois.map((poi, index) => {
                                if (!poi || !(poi.photo instanceof Blob)) return poi;
                                savedPhotos.push({ index, photo: poi.photo });
                                const { photo, ...metadata } = poi;
                                return metadata;
                            });
                        }
                        if (savedPhotos.length) photos.put({ routeId: route.id, photos: savedPhotos });
                        cursor.update(route);
                        cursor.continue();
                    };
                }
            };
            r.onblocked = () => {
                console.warn('La actualizaci\u00f3n de IndexedDB est\u00e1 bloqueada por otra pesta\u00f1a.');
                if (typeof toast === 'function') {
                    toast('Cierra las otras pesta\u00f1as de senda-mtb para terminar la actualizaci\u00f3n.', 7000);
                }
            };
            r.onsuccess = () => {
                const db = r.result;
                db.onversionchange = () => {
                    db.close();
                    if (this.db === db) this.db = null;
                    if (typeof toast === 'function') {
                        toast('La base local se actualiz\u00f3. Recarga esta pesta\u00f1a antes de seguir guardando rutas.', 7000);
                    }
                };
                this.db = db;
                res();
            };
            r.onerror = () => rej(r.error);
        });
    },
    run(store, mode, fn) {
        return new Promise((res, rej) => {
            if (!this.db) return rej(new Error('no-db'));
            try {
                const t = this.db.transaction(store, mode);
                const req = fn(t.objectStore(store));
                t.oncomplete = () => res(req ? req.result : undefined);
                t.onerror = () => rej(t.error);
                t.onabort = () => rej(t.error || new Error('abort'));
            } catch (e) { rej(e); }
        });
    },
    all()       {
        return this.run('routes', 'readonly', s => s.getAll())
            .then(routes => routes.filter(route => !route.trashedAt));
    },
    allTrashedRoutes() {
        return this.run('routes', 'readonly', s => s.getAll())
            .then(routes => routes.filter(route => route.trashedAt));
    },
    moveRouteToTrash(id, deletion, rankingDelete) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['routes', 'kv'], 'readwrite');
                const routes = tx.objectStore('routes');
                const request = routes.get(id);
                let moved = false;
                request.onsuccess = () => {
                    const route = request.result;
                    if (!route) return;
                    route.trashedAt = Date.now();
                    route.trashReason = 'remote-deletion';
                    route.trashRemoteId = deletion.remoteId;
                    route.trashRemoteServer = deletion.server;
                    delete route.remoteDeletionPending;
                    routes.put(route);
                    moved = true;
                };
                request.onerror = () => { try { tx.abort(); } catch (error) {} };
                if (rankingDelete && rankingDelete.ownerId && rankingDelete.server
                    && Number.isSafeInteger(rankingDelete.clientId) && rankingDelete.clientId > 0) {
                    const kv = tx.objectStore('kv');
                    const pendingRequest = kv.get('pendingGroupRankingDeletes');
                    pendingRequest.onsuccess = () => {
                        const pending = Array.isArray(pendingRequest.result) ? pendingRequest.result : [];
                        const exists = pending.some(item => item
                            && item.ownerId === rankingDelete.ownerId
                            && item.server === rankingDelete.server
                            && item.clientId === rankingDelete.clientId);
                        if (!exists) pending.push(rankingDelete);
                        kv.put(pending, 'pendingGroupRankingDeletes');
                    };
                    pendingRequest.onerror = () => { try { tx.abort(); } catch (error) {} };
                }
                tx.oncomplete = () => resolve(moved);
                tx.onerror = () => reject(tx.error || new Error('trash-failed'));
                tx.onabort = () => reject(tx.error || new Error('trash-aborted'));
            } catch (error) { reject(error); }
        });
    },
    restoreTrashedRoute(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction('routes', 'readwrite');
                const store = tx.objectStore('routes');
                const request = store.get(id);
                let restored = null;
                request.onsuccess = () => {
                    const route = request.result;
                    if (!route || !route.trashedAt) return;
                    delete route.trashedAt;
                    delete route.trashReason;
                    delete route.trashRemoteId;
                    delete route.trashRemoteServer;
                    delete route.remoteDeletionPending;
                    route.remoteId = null;
                    delete route.remoteServer;
                    delete route.remoteUpdated;
                    route.dirty = false;
                    store.put(route);
                    restored = route;
                };
                request.onerror = () => { try { tx.abort(); } catch (error) {} };
                tx.oncomplete = () => resolve(restored);
                tx.onerror = () => reject(tx.error || new Error('restore-failed'));
                tx.onabort = () => reject(tx.error || new Error('restore-aborted'));
            } catch (error) { reject(error); }
        });
    },
    purgeExpiredTrashedRoutes(now = Date.now()) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['routes', 'routePhotos'], 'readwrite');
                const routes = tx.objectStore('routes');
                const photos = tx.objectStore('routePhotos');
                const request = routes.openCursor();
                const cutoff = now - ROUTE_TRASH_RETENTION_MS;
                let purged = 0;
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) return;
                    const trashedAt = Number(cursor.value.trashedAt);
                    if (Number.isFinite(trashedAt) && trashedAt > 0 && trashedAt <= cutoff) {
                        photos.delete(cursor.value.id);
                        cursor.delete();
                        purged++;
                    }
                    cursor.continue();
                };
                request.onerror = () => { try { tx.abort(); } catch (error) {} };
                tx.oncomplete = () => resolve(purged);
                tx.onerror = () => reject(tx.error || new Error('trash-purge-failed'));
                tx.onabort = () => reject(tx.error || new Error('trash-purge-aborted'));
            } catch (error) { reject(error); }
        });
    },
    put(route, options = {})  {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['routes', 'routePhotos'], 'readwrite');
                const record = { ...route };
                const photos = [];
                if (Array.isArray(route.pois)) {
                    record.pois = route.pois.map((poi, index) => {
                        if (!poi || !(poi.photo instanceof Blob)) return poi;
                        photos.push({ index, photo: poi.photo });
                        const { photo, ...metadata } = poi;
                        return metadata;
                    });
                }
                tx.objectStore('routes').put(record);
                const photoStore = tx.objectStore('routePhotos');
                if (photos.length) photoStore.put({ routeId: route.id, photos });
                else if (options.replacePhotos) photoStore.delete(route.id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('save-failed'));
                tx.onabort = () => reject(tx.error || new Error('save-aborted'));
            } catch (e) { reject(e); }
        });
    },
    del(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['routes', 'routePhotos'], 'readwrite');
                tx.objectStore('routes').delete(id);
                tx.objectStore('routePhotos').delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('delete-failed'));
                tx.onabort = () => reject(tx.error || new Error('delete-aborted'));
            } catch (e) { reject(e); }
        });
    },
    async loadRoutePhotos(route) {
        if (!route || !Array.isArray(route.pois)) return route;
        const stored = await this.run('routePhotos', 'readonly', store => store.get(route.id));
        if (!stored || !Array.isArray(stored.photos)) return route;
        const pois = route.pois.slice();
        stored.photos.forEach(item => {
            if (!Number.isInteger(item.index) || item.index < 0 || !(item.photo instanceof Blob)) return;
            pois[item.index] = { ...(pois[item.index] || {}), photo: item.photo };
        });
        route.pois = pois;
        return route;
    },
    deleteRoute(id, remoteId, rankingDelete) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction(['routes', 'kv', 'routePhotos'], 'readwrite');
                tx.objectStore('routes').delete(id);
                tx.objectStore('routePhotos').delete(id);
                if (remoteId) {
                    const kv = tx.objectStore('kv');
                    const req = kv.get('pendingDeletes');
                    req.onsuccess = () => {
                        const pending = Array.isArray(req.result) ? req.result : [];
                        if (!pending.includes(remoteId)) pending.push(remoteId);
                        kv.put(pending, 'pendingDeletes');
                    };
                    req.onerror = () => { try { tx.abort(); } catch (e) {} };
                }
                if (rankingDelete && rankingDelete.ownerId && rankingDelete.server
                    && Number.isSafeInteger(rankingDelete.clientId) && rankingDelete.clientId > 0) {
                    const kv = tx.objectStore('kv');
                    const req = kv.get('pendingGroupRankingDeletes');
                    req.onsuccess = () => {
                        const pending = Array.isArray(req.result) ? req.result : [];
                        const exists = pending.some(item => item
                            && item.ownerId === rankingDelete.ownerId
                            && item.server === rankingDelete.server
                            && item.clientId === rankingDelete.clientId);
                        if (!exists) pending.push(rankingDelete);
                        kv.put(pending, 'pendingGroupRankingDeletes');
                    };
                    req.onerror = () => { try { tx.abort(); } catch (e) {} };
                }
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('delete-failed'));
                tx.onabort = () => reject(tx.error || new Error('delete-aborted'));
            } catch (e) { reject(e); }
        });
    },
    kvGet(k)    { return this.run('kv', 'readonly',  s => s.get(k)); },
    kvSet(k, v) { return this.run('kv', 'readwrite', s => s.put(v, k)); },
    kvDel(k)    { return this.run('kv', 'readwrite', s => s.delete(k)); },
    kvKeys()    { return this.run('kv', 'readonly',  s => s.getAllKeys()); },
    kvSaveDraft(draft, chunks) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction('kv', 'readwrite');
                const store = tx.objectStore('kv');
                chunks.forEach(chunk => store.put(chunk.points, `draft:points:${chunk.index}`));
                store.put(draft, 'draft');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('draft-save-failed'));
                tx.onabort = () => reject(tx.error || new Error('draft-save-aborted'));
            } catch (error) { reject(error); }
        });
    },
    kvGetDraftPointChunks() {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction('kv', 'readonly');
                const store = tx.objectStore('kv');
                let requests = [];
                const keysRequest = store.getAllKeys();
                keysRequest.onsuccess = () => {
                    const prefix = 'draft:points:';
                    const entries = keysRequest.result
                        .filter(key => typeof key === 'string' && /^draft:points:\d+$/.test(key))
                        .map(key => ({ key, index: Number(key.slice(prefix.length)) }))
                        .sort((a, b) => a.index - b.index);
                    requests = entries.map(entry => ({
                        index: entry.index,
                        request: store.get(entry.key)
                    }));
                };
                tx.oncomplete = () => resolve(requests.map(entry => ({
                    index: entry.index,
                    points: entry.request.result
                })));
                tx.onerror = () => reject(tx.error || new Error('draft-load-failed'));
                tx.onabort = () => reject(tx.error || new Error('draft-load-aborted'));
            } catch (error) { reject(error); }
        });
    },
    kvClearDraft() {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('no-db'));
            try {
                const tx = this.db.transaction('kv', 'readwrite');
                const store = tx.objectStore('kv');
                store.delete('draft');
                const keysRequest = store.getAllKeys();
                keysRequest.onsuccess = () => {
                    keysRequest.result.forEach(key => {
                        if (typeof key === 'string' && key.startsWith('draft:points:')) {
                            store.delete(key);
                        }
                    });
                };
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('draft-delete-failed'));
                tx.onabort = () => reject(tx.error || new Error('draft-delete-aborted'));
            } catch (error) { reject(error); }
        });
    }
};

/*
 Modelo de ruta:
 { id, kind: 'recorded' | 'imported', activityType?, name, startedAt (ISO), movingTimeSec,
   distanceKm (número), elevationGain (m), hrAvg,
   points: [ [lat, lon, alt|null, tiempoMs|null, bpm|null, (1 = inicio de tramo nuevo), speedKmh?, cadenceRpm?, powerWatts?] ] }
*/

// ============================================================
//  DESNIVEL SUAVIZADO
// ============================================================
function makeElevTracker() {
    return MTBStatisticsEngine.createElevationTracker({ threshold: ELEV_STEP, smoothingWindow: 5 });
}

// Desnivel positivo acumulado en cada punto de un track con altitud en p[2].
function gainCumulative(points) {
    const tracker = makeElevTracker();
    const out = new Float64Array(points.length);
    points.forEach((p, i) => {
        if (i > 0 && p[5] === 1) tracker.reset();
        tracker.add(p[2] == null ? null : Number(p[2]));
        const storedGain = p[9] == null ? NaN : Number(p[9]);
        out[i] = Number.isFinite(storedGain) && storedGain >= 0 ? storedGain : tracker.gain;
    });
    return out;
}

// ============================================================
