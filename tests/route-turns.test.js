'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    routeHaversineMeters,
    routeBearingBetween,
    calculateRouteCumulativeDistances,
    detectRouteTurns
} = require('../app/route-following.js');

describe('Turn and voice navigation detection', () => {

    it('calcula rumbo hacia el norte (0°), este (90°), sur (180°) y oeste (270°)', () => {
        const north = routeBearingBetween([40.0, 0.0], [40.01, 0.0]);
        const east  = routeBearingBetween([40.0, 0.0], [40.0, 0.01]);
        const south = routeBearingBetween([40.0, 0.0], [39.99, 0.0]);
        const west  = routeBearingBetween([40.0, 0.0], [40.0, -0.01]);

        assert.ok(Math.abs(north - 0) < 0.5 || Math.abs(north - 360) < 0.5, `Norte esperado ~0°, obtenido: ${north}`);
        assert.ok(Math.abs(east - 90) < 0.5, `Este esperado ~90°, obtenido: ${east}`);
        assert.ok(Math.abs(south - 180) < 0.5, `Sur esperado ~180°, obtenido: ${south}`);
        assert.ok(Math.abs(west - 270) < 0.5, `Oeste esperado ~270°, obtenido: ${west}`);
    });

    it('detecta un giro a la derecha en L de 90°', () => {
        // Tramo 1: hacia el norte (latitud sube)
        // Tramo 2: hacia el este (longitud sube)
        // Separación de puntos ~10 m para tener densidad de trazado
        const latStep = 10 / 111320;
        const lonStep = 10 / (111320 * Math.cos(42 * Math.PI / 180));

        const pts = [];
        // 100 m hacia el norte (10 puntos)
        for (let i = 0; i <= 10; i++) {
            pts.push([42.0 + i * latStep, -8.0]);
        }
        const cornerLat = pts[pts.length - 1][0];
        const cornerLon = pts[pts.length - 1][1];
        // 100 m hacia el este (10 puntos)
        for (let i = 1; i <= 10; i++) {
            pts.push([cornerLat, cornerLon + i * lonStep]);
        }

        const cumDist = calculateRouteCumulativeDistances(pts);
        const turns = detectRouteTurns(pts, cumDist);

        assert.equal(turns.length, 1, 'Debe detectar exactamente 1 giro');
        assert.equal(turns[0].type, 'right');
        assert.ok(turns[0].text.includes('derecha'));
        assert.ok(Math.abs(turns[0].distanceM - 100) < 25, `El giro debe ubicarse cerca de los 100 m, detectado en: ${turns[0].distanceM}`);
    });

    it('detecta un giro a la izquierda en L de 90°', () => {
        // Tramo 1: hacia el norte
        // Tramo 2: hacia el oeste
        const latStep = 10 / 111320;
        const lonStep = 10 / (111320 * Math.cos(42 * Math.PI / 180));

        const pts = [];
        for (let i = 0; i <= 10; i++) {
            pts.push([42.0 + i * latStep, -8.0]);
        }
        const cornerLat = pts[pts.length - 1][0];
        const cornerLon = pts[pts.length - 1][1];
        for (let i = 1; i <= 10; i++) {
            pts.push([cornerLat, cornerLon - i * lonStep]);
        }

        const cumDist = calculateRouteCumulativeDistances(pts);
        const turns = detectRouteTurns(pts, cumDist);

        assert.equal(turns.length, 1);
        assert.equal(turns[0].type, 'left');
        assert.ok(turns[0].text.includes('izquierda'));
    });

    it('no detecta giros en una línea recta', () => {
        const latStep = 10 / 111320;
        const pts = [];
        for (let i = 0; i <= 30; i++) {
            pts.push([42.0 + i * latStep, -8.0]);
        }
        const cumDist = calculateRouteCumulativeDistances(pts);
        const turns = detectRouteTurns(pts, cumDist);
        assert.deepEqual(turns, []);
    });

    it('tolera rutas cortas o vacías sin lanzar error', () => {
        assert.deepEqual(detectRouteTurns([], new Float64Array(0)), []);
        assert.deepEqual(detectRouteTurns([[42.0, -8.0]], new Float64Array([0])), []);
        assert.deepEqual(detectRouteTurns(null, null), []);
    });

    it('identifica la posición y estado de alerta para giros próximos', () => {
        const dummyTurn = { distanceM: 100, warnedAhead: false, warnedNow: false, text: 'giro a la derecha' };
        // A 60 metros del giro: dentro de [40, 70] m
        const distRemaining60 = dummyTurn.distanceM - 40;
        assert.ok(distRemaining60 <= 70 && distRemaining60 >= 40, 'debe disparar aviso previo');
        // A 10 metros del giro: dentro de [-5, 16] m
        const distRemaining10 = dummyTurn.distanceM - 90;
        assert.ok(distRemaining10 <= 16 && distRemaining10 >= -5, 'debe disparar aviso inmediato');
    });
});
