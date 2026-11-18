'use strict';

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./statistics-engine.js'));
    } else {
        root.MTBDem = factory(root.MTBStatistics);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MTBStatistics) {
    const DEM_TILE_SIZE = 512;
    const DEM_DEFAULT_ZOOM = 12; // ~38 m/px en el ecuador, ~28 m/px en España: óptimo para rutas MTB
    const DEM_URL_TEMPLATE = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';

    function demLatLonToTile(lat, lon, zoom = DEM_DEFAULT_ZOOM) {
        const n = 2 ** zoom;
        const latNum = Number(lat);
        const lonNum = Number(lon);
        const latClamped = Math.max(-85.05112878, Math.min(85.05112878, latNum));
        const latRad = (latClamped * Math.PI) / 180;
        const xFloat = ((lonNum + 180) / 360) * n;
        const yFloat = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;

        const x = Math.floor(xFloat);
        const y = Math.floor(yFloat);

        const px = Math.min(DEM_TILE_SIZE - 1, Math.max(0, Math.floor((xFloat - x) * DEM_TILE_SIZE)));
        const py = Math.min(DEM_TILE_SIZE - 1, Math.max(0, Math.floor((yFloat - y) * DEM_TILE_SIZE)));

        return { z: zoom, x, y, px, py };
    }

    function demDecodeElevation(r, g, b) {
        return (r * 256 + g + b / 256) - 32768;
    }

    async function demFetchTileData(z, x, y, options = {}) {
        const urlTemplate = options.urlTemplate || DEM_URL_TEMPLATE;
        const url = urlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        const timeoutMs = options.timeoutMs || 10000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
            if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
            const blob = await response.blob();
            const bitmap = await createImageBitmap(blob);
            const canvas = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(bitmap.width, bitmap.height)
                : document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(bitmap, 0, 0);
            const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
            if (typeof bitmap.close === 'function') bitmap.close();
            return imageData;
        } finally {
            clearTimeout(timer);
        }
    }

    function demSampleElevationFromImageData(imageData, px, py) {
        if (!imageData || !imageData.data) return null;
        const idx = (py * imageData.width + px) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        return demDecodeElevation(r, g, b);
    }

    async function refineRouteWithDem(route, options = {}) {
        if (!route || !Array.isArray(route.points) || route.points.length < 2) {
            throw new Error('La ruta no tiene suficientes puntos para calibrar.');
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine && !options.mockTileFetcher) {
            throw new Error('La calibración con DEM requiere conexión a internet.');
        }

        const zoom = options.zoom || DEM_DEFAULT_ZOOM;
        const tileCache = new Map();
        const neededTiles = new Set();

        route.points.forEach(point => {
            if (!Array.isArray(point)) return;
            const lat = Number(point[0]);
            const lon = Number(point[1]);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                const { z, x, y } = demLatLonToTile(lat, lon, zoom);
                neededTiles.add(`${z}/${x}/${y}`);
            }
        });

        if (neededTiles.size === 0) {
            throw new Error('No se encontraron coordenadas válidas en la ruta.');
        }

        const fetchTile = options.mockTileFetcher || demFetchTileData;
        const downloadPromises = Array.from(neededTiles).map(async key => {
            const [z, x, y] = key.split('/').map(Number);
            try {
                const data = await fetchTile(z, x, y, options);
                if (data) tileCache.set(key, data);
            } catch (err) {
                console.warn(`No se pudo descargar la tesela DEM ${key}:`, err);
            }
        });

        await Promise.all(downloadPromises);

        if (tileCache.size === 0) {
            throw new Error('No se pudo descargar ninguna tesela DEM del terreno.');
        }

        // Conserva las cotas originales si no estaban guardadas previamente
        if (!Array.isArray(route.originalAltitudes)) {
            route.originalAltitudes = route.points.map(p => (Array.isArray(p) && Number.isFinite(p[2]) ? p[2] : null));
        }
        if (route.originalElevationGain == null && route.elevationGain != null) {
            route.originalElevationGain = Number(route.elevationGain);
        }

        let correctedCount = 0;
        route.points.forEach(point => {
            if (!Array.isArray(point)) return;
            const lat = Number(point[0]);
            const lon = Number(point[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

            const { z, x, y, px, py } = demLatLonToTile(lat, lon, zoom);
            const key = `${z}/${x}/${y}`;
            const tileData = tileCache.get(key);
            if (tileData) {
                const demEle = demSampleElevationFromImageData(tileData, px, py);
                if (Number.isFinite(demEle)) {
                    point[2] = Math.round(demEle * 10) / 10;
                    correctedCount++;
                }
            }
        });

        if (correctedCount === 0) {
            throw new Error('No se pudieron obtener cotas DEM válidas para la ruta.');
        }

        // Recalcula el desnivel acumulado y estadísticas con el motor unificado de MTBStatistics
        const statsEngine = options.statisticsEngine || MTBStatistics;
        if (statsEngine && typeof statsEngine.analyzeRoute === 'function') {
            const analysis = statsEngine.analyzeRoute(route);
            route.elevationGain = Math.round(analysis.ascentM || 0);
            if (Number.isFinite(analysis.descentM)) route.elevationLoss = Math.round(analysis.descentM);
            if (Number.isFinite(analysis.maxAltitude)) route.maxAltitude = Math.round(analysis.maxAltitude);
            if (Number.isFinite(analysis.minAltitude)) route.minAltitude = Math.round(analysis.minAltitude);
        }

        route.demCorrected = true;
        route.dirty = true;
        return route;
    }

    function revertRouteDem(route, options = {}) {
        if (!route || !Array.isArray(route.points) || !Array.isArray(route.originalAltitudes)) {
            throw new Error('Esta ruta no dispone de altitudes originales guardadas.');
        }

        route.points.forEach((point, index) => {
            if (!Array.isArray(point)) return;
            const original = route.originalAltitudes[index];
            point[2] = original !== undefined ? original : point[2];
        });

        if (route.originalElevationGain != null) {
            route.elevationGain = route.originalElevationGain;
        } else {
            const statsEngine = options.statisticsEngine || MTBStatistics;
            if (statsEngine && typeof statsEngine.analyzeRoute === 'function') {
                const analysis = statsEngine.analyzeRoute(route);
                route.elevationGain = Math.round(analysis.ascentM || 0);
            }
        }

        delete route.demCorrected;
        delete route.originalAltitudes;
        delete route.originalElevationGain;
        route.dirty = true;
        return route;
    }

    return {
        DEM_TILE_SIZE,
        DEM_DEFAULT_ZOOM,
        DEM_URL_TEMPLATE,
        demLatLonToTile,
        demDecodeElevation,
        demFetchTileData,
        demSampleElevationFromImageData,
        refineRouteWithDem,
        revertRouteDem
    };
});
