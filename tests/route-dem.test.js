'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const MTBDem = require('../app/route-dem.js');
const MTBStatistics = require('../app/statistics-engine.js');

test('demLatLonToTile calculates valid tile and pixel coordinates within bounds', () => {
    // Madrid
    const madrid = MTBDem.demLatLonToTile(40.4168, -3.7038, 12);
    assert.equal(madrid.z, 12);
    assert.ok(madrid.x >= 0 && madrid.x < 4096);
    assert.ok(madrid.y >= 0 && madrid.y < 4096);
    assert.ok(madrid.px >= 0 && madrid.px < 512);
    assert.ok(madrid.py >= 0 && madrid.py < 512);

    // Extreme latitude clamping
    const pole = MTBDem.demLatLonToTile(89.9, 0, 12);
    assert.ok(pole.py >= 0 && pole.py < 512);
});

test('demDecodeElevation correctly decodes Terrarium RGB encoding', () => {
    // Sea level: (128 * 256 + 0 + 0) - 32768 = 0
    assert.equal(MTBDem.demDecodeElevation(128, 0, 0), 0);

    // 500 meters: (129 * 256 + 244 + 0) - 32768 = 33024 + 244 - 32768 = 500
    assert.equal(MTBDem.demDecodeElevation(129, 244, 0), 500);

    // -100 meters: (127 * 256 + 156 + 0) - 32768 = 32512 + 156 - 32768 = -100
    assert.equal(MTBDem.demDecodeElevation(127, 156, 0), -100);
});

test('refineRouteWithDem samples altitudes, recalculates elevation gain and allows reversion', async () => {
    // Create a mock ImageData 512x512 with a known gradient (e.g. 200m at start, 350m at middle, 500m at end)
    const mockImageData = {
        width: 512,
        height: 512,
        data: new Uint8ClampedArray(512 * 512 * 4)
    };

    // Fill with default ~300m: 32768 + 300 = 33068 => R=129, G=44
    for (let i = 0; i < mockImageData.data.length; i += 4) {
        mockImageData.data[i] = 129;
        mockImageData.data[i + 1] = 44;
        mockImageData.data[i + 2] = 0;
        mockImageData.data[i + 3] = 255;
    }

    const route = {
        name: 'Ruta de prueba',
        elevationGain: 999, // original noisy GPS elevation gain
        points: [
            [42.878, -8.544, 150, 1000, 4.5, 0],
            [42.879, -8.543, 190, 2000, 4.2, 0],
            [42.880, -8.542, 240, 3000, 4.0, 0]
        ]
    };

    const mockFetcher = async (z, x, y) => mockImageData;

    const refined = await MTBDem.refineRouteWithDem(route, {
        mockTileFetcher: mockFetcher,
        statisticsEngine: MTBStatistics
    });

    assert.equal(refined.demCorrected, true);
    assert.equal(refined.dirty, true);
    assert.equal(refined.originalElevationGain, 999);
    assert.deepEqual(refined.originalAltitudes, [150, 190, 240]);
    // The points should now have the decoded DEM elevation (~300m)
    assert.equal(refined.points[0][2], 300);
    assert.equal(refined.points[1][2], 300);
    assert.equal(refined.points[2][2], 300);

    // Now test reverting back
    const reverted = MTBDem.revertRouteDem(refined, { statisticsEngine: MTBStatistics });
    assert.equal(reverted.demCorrected, undefined);
    assert.equal(reverted.elevationGain, 999);
    assert.equal(reverted.points[0][2], 150);
    assert.equal(reverted.points[1][2], 190);
    assert.equal(reverted.points[2][2], 240);
});
