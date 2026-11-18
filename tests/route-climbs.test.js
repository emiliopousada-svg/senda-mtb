'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Cargar módulo en contexto Node.js
const { detectClimbs, climbProgress } = require('../app/route-climbs.js');

// ── Helpers ───────────────────────────────────────────────────
/**
 * Genera una secuencia de puntos [lat, lon, alt] con distancias uniformes.
 * @param {number[]} altProfile  — altitudes en metros para cada punto
 * @param {number}   stepM       — separación en metros entre puntos (≈ latDelta)
 */
function makePoints(altProfile, stepM = 100) {
    const latStep = stepM / 111320; // grados de latitud por metro
    return altProfile.map((alt, i) => [
        42.0 + i * latStep,  // lat incremental (sentido norte)
        -8.0,                // lon fijo
        alt,                 // altitud
        Date.now() + i * 5000
    ]);
}

// ── Tests detectClimbs ────────────────────────────────────────
describe('detectClimbs', () => {

    it('devuelve array vacío para ruta plana', () => {
        const pts = makePoints(Array(50).fill(300));
        const result = detectClimbs(pts);
        assert.deepEqual(result, []);
    });

    it('devuelve array vacío si points es null/undefined', () => {
        assert.deepEqual(detectClimbs(null), []);
        assert.deepEqual(detectClimbs(undefined), []);
        assert.deepEqual(detectClimbs([]), []);
    });

    it('devuelve array vacío para ruta de bajada', () => {
        const alts = Array.from({ length: 30 }, (_, i) => 500 - i * 10); // descenso
        const pts  = makePoints(alts);
        const result = detectClimbs(pts);
        assert.deepEqual(result, []);
    });

    it('detecta una subida obvia (200 m desnivel, 2 km)', () => {
        // 20 puntos cada 100 m = 2 km; altitud sube 10 m/punto → 200 m desnivel
        const alts = Array.from({ length: 21 }, (_, i) => 300 + i * 10);
        const pts  = makePoints(alts, 100);
        const result = detectClimbs(pts, { minGainM: 80, minLengthM: 400, minGradePercent: 3 });
        assert.equal(result.length, 1, 'debe detectar exactamente 1 subida');
        assert.equal(result[0].number, 1);
        assert.ok(result[0].gainM >= 150, `gainM esperado ≥150, obtenido ${result[0].gainM}`);
        assert.ok(result[0].lengthM >= 1500, `lengthM esperado ≥1500, obtenido ${result[0].lengthM}`);
        assert.ok(result[0].avgGrade >= 3, `avgGrade esperado ≥3, obtenido ${result[0].avgGrade}`);
    });

    it('ignora repecho pequeño (<80 m ganancia)', () => {
        // 50 m desnivel en 500 m: no supera minGainM=80
        const alts = Array.from({ length: 11 }, (_, i) => 300 + i * 5);
        const pts  = makePoints(alts, 50);
        const result = detectClimbs(pts, { minGainM: 80, minLengthM: 400, minGradePercent: 3 });
        assert.deepEqual(result, []);
    });

    it('detecta dos subidas separadas por un descenso', () => {
        // subida 1: puntos 0-15 (+150 m)
        // bajada: puntos 15-20 (−30 m)  — se rompe la subida
        // subida 2: puntos 20-35 (+150 m)
        const alts = [
            ...Array.from({ length: 16 }, (_, i) => 300 + i * 10),  // 300–450
            ...Array.from({ length: 5  }, (_, i) => 450 - i * 7),   // 450–422 (bajada)
            ...Array.from({ length: 16 }, (_, i) => 422 + i * 10)   // 422–572
        ];
        const pts = makePoints(alts, 100);
        const result = detectClimbs(pts, { minGainM: 80, minLengthM: 400, minGradePercent: 3 });
        assert.ok(result.length >= 2, `debe haber ≥2 subidas, encontradas: ${result.length}`);
        result.forEach((c, i) => assert.equal(c.number, i + 1, 'numeración correlativa'));
    });

    it('las subidas tienen todas las propiedades requeridas', () => {
        const alts = Array.from({ length: 21 }, (_, i) => 200 + i * 10);
        const pts  = makePoints(alts, 100);
        const result = detectClimbs(pts);
        assert.ok(result.length > 0);
        const c = result[0];
        const requiredKeys = ['number', 'startDistM', 'endDistM', 'startAlt', 'endAlt', 'gainM', 'lengthM', 'avgGrade'];
        requiredKeys.forEach(k => assert.ok(k in c, `falta propiedad ${k}`));
        assert.ok(c.startDistM <= c.endDistM, 'startDistM debe ser ≤ endDistM');
        assert.ok(c.startAlt < c.endAlt, 'startAlt debe ser < endAlt en una subida');
    });

    it('tolera puntos sin altitud (null/undefined)', () => {
        const alts = [300, null, 310, undefined, 320, 330, 340, 350, 360, 370, 380, 390, 400];
        const pts  = alts.map((a, i) => [42.0 + i * 0.001, -8.0, a]);
        // No debe lanzar excepción
        assert.doesNotThrow(() => detectClimbs(pts));
    });
});

// ── Tests climbProgress ───────────────────────────────────────
describe('climbProgress', () => {

    const climbs = [
        { number: 1, startDistM: 1000, endDistM: 3000, startAlt: 300, endAlt: 500, gainM: 200, lengthM: 2000, avgGrade: 10 },
        { number: 2, startDistM: 5000, endDistM: 7000, startAlt: 400, endAlt: 550, gainM: 150, lengthM: 2000, avgGrade: 7.5 }
    ];

    it('devuelve active:null cuando estamos antes de cualquier subida', () => {
        const r = climbProgress(climbs, 500);
        assert.equal(r.active, null);
    });

    it('devuelve active:null cuando estamos entre dos subidas', () => {
        const r = climbProgress(climbs, 4000);
        assert.equal(r.active, null);
    });

    it('devuelve active:null cuando hemos superado todas las subidas', () => {
        const r = climbProgress(climbs, 9000);
        assert.equal(r.active, null);
    });

    it('devuelve la subida activa correcta en mitad de la primera', () => {
        const r = climbProgress(climbs, 2000); // mitad de la subida 1
        assert.ok(r.active !== null, 'debe haber subida activa');
        assert.equal(r.active.number, 1);
        assert.equal(r.progressM, 1000);
        assert.equal(r.remainingM, 1000);
        assert.ok(Math.abs(r.percentComplete - 0.5) < 0.01, 'percentComplete ≈ 0.5');
    });

    it('remainingGainM decae correctamente al avanzar', () => {
        const r0 = climbProgress(climbs, 1000); // inicio subida 1
        const r1 = climbProgress(climbs, 2000); // mitad subida 1
        assert.ok(r0.remainingGainM > r1.remainingGainM, 'el desnivel restante debe bajar al avanzar');
        assert.equal(r0.remainingGainM, 200); // al inicio queda todo el desnivel
        assert.equal(r1.remainingGainM, 100); // a mitad queda la mitad
    });

    it('remainingM es 0 al llegar al final de la subida', () => {
        const r = climbProgress(climbs, 3000);
        assert.equal(r.remainingM, 0);
    });

    it('devuelve active:null con array vacío', () => {
        const r = climbProgress([], 1500);
        assert.equal(r.active, null);
    });

    it('devuelve active:null con distancia NaN', () => {
        const r = climbProgress(climbs, NaN);
        assert.equal(r.active, null);
    });
});
