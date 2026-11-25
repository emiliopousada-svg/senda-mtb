const test = require('node:test');
const assert = require('node:assert/strict');
const {
    REGION_BOUNDS,
    regionTiles,
    estimateRegionTileCount,
    formatOfflineBytes,
    MAX_DOWNLOADED_IGN_BYTES,
    OFFLINE_STORAGE_RESERVE_BYTES,
    MAX_DOWNLOADED_IGN_TILES,
    MAX_TILES_PER_DOWNLOAD,
    ONLINE_TILE_OFFLINE_CACHE_ENABLED,
    formatOnlineTileCacheStatus,
    isTileProviderRateLimit,
    ignTileUrl,
    tileKey,
    onlineTileKey
} = require('../app/offline-maps.js');

test('REGION_BOUNDS defines valid bounding boxes for all 18 supported regions', () => {
    const expectedRegions = [
        'andalucia', 'aragon', 'asturias', 'baleares', 'canarias',
        'cantabria', 'castilla-la-mancha', 'castilla-y-leon', 'cataluna',
        'comunidad-valenciana', 'extremadura', 'galicia', 'madrid',
        'murcia', 'navarra', 'pais-vasco', 'la-rioja', 'portugal'
    ];

    assert.equal(Object.keys(REGION_BOUNDS).length, 18);
    for (const region of expectedRegions) {
        assert.ok(REGION_BOUNDS[region], `La región ${region} debe estar definida`);
        assert.ok(Array.isArray(REGION_BOUNDS[region]) && REGION_BOUNDS[region].length > 0);

        for (const box of REGION_BOUNDS[region]) {
            assert.ok(box.west < box.east, `${region}: west (${box.west}) debe ser menor que east (${box.east})`);
            assert.ok(box.south < box.north, `${region}: south (${box.south}) debe ser menor que north (${box.north})`);
            assert.ok(box.west >= -180 && box.east <= 180, `${region}: longitud fuera de rango`);
            assert.ok(box.south >= -90 && box.north <= 90, `${region}: latitud fuera de rango`);
        }
    }
});

test('estimateRegionTileCount accurately returns tile counts for regions', () => {
    assert.equal(estimateRegionTileCount('galicia', 13), 5255);
    assert.equal(estimateRegionTileCount('madrid', 13), 2045);
    assert.equal(estimateRegionTileCount('asturias', 13), 1672);
    assert.equal(estimateRegionTileCount('cantabria', 13), 1281);
    assert.equal(estimateRegionTileCount('la-rioja', 13), 1347);

    // Región inexistente devuelve null
    assert.equal(estimateRegionTileCount('francia', 13), null);
});

test('regionTiles returns valid tile sets and rejects unknown regions', () => {
    assert.throws(
        () => regionTiles('francia', 13),
        /La comunidad seleccionada no tiene un área de descarga definida/
    );

    const tiles = regionTiles('asturias', 13);
    assert.ok(Array.isArray(tiles));
    assert.equal(tiles.length, 1672);

    const sample = tiles[0];
    assert.ok(Number.isInteger(sample.z) && sample.z >= 7 && sample.z <= 13);
    assert.ok(Number.isInteger(sample.x) && sample.x >= 0);
    assert.ok(Number.isInteger(sample.y) && sample.y >= 0);
});

test('regionTiles rejects regions exceeding MAX_TILES_PER_DOWNLOAD at high zoom', () => {
    // Andalucía con zoom 14 supera el límite de 25.000 teselas
    assert.throws(
        () => regionTiles('andalucia', 14),
        /supera el límite de 25\.000 teselas por descarga/
    );

    // Castilla y León con zoom 14 también lo supera
    assert.throws(
        () => regionTiles('castilla-y-leon', 14),
        /supera el límite de 25\.000 teselas por descarga/
    );
});

test('ignTileUrl converts to TMS reversed Y coordinates', () => {
    const z = 10;
    const x = 500;
    const y = 300;
    const expectedTmsY = Math.pow(2, z) - 1 - y; // 1024 - 1 - 300 = 723

    const url = ignTileUrl(z, x, y);
    assert.equal(url, `https://tms-mapa-raster.ign.es/1.0.0/mapa-raster/10/500/${expectedTmsY}.jpeg`);
});

test('online tile styles do not persist offline by default', () => {
    // Los estilos online no se persisten offline sin permiso explícito del proveedor.
    assert.equal(
        ONLINE_TILE_OFFLINE_CACHE_ENABLED,
        false,
        'La caché persistente offline de estilos online debe seguir desactivada'
    );
});

test('disabled online tile cache identifies legacy records as inactive', () => {
    assert.equal(formatOnlineTileCacheStatus(0), 'caché persistente online desactivada');
    assert.equal(
        formatOnlineTileCacheStatus(12),
        '12 teselas online heredadas (inactivas; no se usan sin conexión)'
    );
});

test('HTTP 429 is identified as a provider rate limit', () => {
    assert.equal(isTileProviderRateLimit({ status: 429 }), true);
    assert.equal(isTileProviderRateLimit({ status: 503 }), false);
    assert.equal(isTileProviderRateLimit(new Error('Network error')), false);
});

test('quota constants and reserve match specification', () => {
    assert.equal(MAX_DOWNLOADED_IGN_BYTES, 256 * 1024 * 1024, 'El límite de mapas IGN descargados debe ser 256 MiB');
    assert.equal(OFFLINE_STORAGE_RESERVE_BYTES, 128 * 1024 * 1024, 'La reserva de almacenamiento del móvil debe ser 128 MiB');
    assert.equal(MAX_DOWNLOADED_IGN_TILES, 30000, 'El límite máximo de teselas descargadas debe ser 30.000');
    assert.equal(MAX_TILES_PER_DOWNLOAD, 25000, 'El límite por descarga individual debe ser 25.000');
});

test('formatOfflineBytes formats values correctly', () => {
    assert.match(formatOfflineBytes(0), /^0\s*MiB$/);
    assert.match(formatOfflineBytes(1048576), /^1\s*MiB$/);
    assert.match(formatOfflineBytes(268435456), /^256\s*MiB$/);
    assert.match(formatOfflineBytes(52428800), /^50\s*MiB$/);
});

test('tileKey and onlineTileKey generate unique formatted identifiers', () => {
    assert.equal(tileKey(12, 2045, 1500), '12/2045/1500');
    assert.equal(onlineTileKey('cyclosm', 14, 4000, 3100), 'cyclosm/14/4000/3100');
});
