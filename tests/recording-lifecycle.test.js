const test = require('node:test');
const assert = require('node:assert/strict');

const {
    bearingBetween,
    isUsableAltitude,
    gpsSpeedFromFix,
    resetGpsSpeedFix,
    GPS_ACTIVE_OPTIONS,
    GPS_FOLLOW_OPTIONS,
    GPS_LOW_POWER_OPTIONS,
    GPS_MAX_ACC_M,
    GPS_MIN_STEP_M,
    GPS_MAX_SPEED_MS
} = require('../app/gps.js');

const {
    buildSegments,
    autoPauseMovementThreshold,
    autoResumeMovementThreshold,
    isDraftRecoverable,
    rideAccountRequirement
} = require('../app/recording.js');

test('isDraftRecoverable validates raw draft objects before user recovery prompt', () => {
    assert.equal(isDraftRecoverable(null), false);
    assert.equal(isDraftRecoverable(undefined), false);
    assert.equal(isDraftRecoverable({}), false);
    assert.equal(isDraftRecoverable({ points: [] }), false);
    assert.equal(isDraftRecoverable({ points: 'not an array' }), false);
    assert.equal(isDraftRecoverable({ points: [[NaN, -8.6]] }), false);
    assert.equal(isDraftRecoverable({ points: [[42.1, null]] }), false);

    assert.equal(isDraftRecoverable({
        startedAt: '2026-11-16T10:00:00Z',
        totalDistance: 12.5,
        points: [
            [42.235, -8.725, 120, 1700000000000, 145, null],
            [42.236, -8.726, 125, 1700000005000, 148, null]
        ]
    }), true);
});

test('buildSegments splits multi-segment tracks on pause breaks without cross-gap connection', () => {
    // Un track continuo sin breaks genera un único segmento
    const continuousPoints = [
        [42.100, -8.600, 100, 1000, 120, null],
        [42.101, -8.601, 105, 2000, 122, null],
        [42.102, -8.602, 110, 3000, 125, null]
    ];
    const singleSegment = buildSegments(continuousPoints);
    assert.equal(singleSegment.length, 1);
    assert.equal(singleSegment[0].length, 3);
    assert.deepEqual(singleSegment[0][0], [42.100, -8.600]);

    // Un track con pausa (point[5] === 1) divide en dos segmentos separados
    const brokenPoints = [
        [42.100, -8.600, 100, 1000, 120, null],
        [42.101, -8.601, 105, 2000, 122, null],
        [42.150, -8.650, 150, 50000, 110, 1], // reanudación tras pausa
        [42.151, -8.651, 152, 52000, 115, null]
    ];
    const twoSegments = buildSegments(brokenPoints);
    assert.equal(twoSegments.length, 2);
    assert.equal(twoSegments[0].length, 2);
    assert.equal(twoSegments[1].length, 2);
    assert.deepEqual(twoSegments[0][1], [42.101, -8.601]);
    assert.deepEqual(twoSegments[1][0], [42.150, -8.650]);
});

test('gpsSpeedFromFix calculates realistic speeds and discards poor fixes', () => {
    resetGpsSpeedFix();

    // Precisión inaceptable (> 30 m)
    assert.equal(gpsSpeedFromFix([42.0, -8.0], 1000, 35), null);
    assert.equal(gpsSpeedFromFix([42.0, -8.0], 1000, -1), null);

    // Primer fix establece el punto de anclaje inicial -> velocidad 0
    assert.equal(gpsSpeedFromFix([42.0, -8.0], 1000, 10), 0);

    // Movimiento realista: 20 metros al norte en 2 segundos (~10 m/s = ~36 km/h)
    // 1 grado latitud ~ 111.139 metros -> 20 m ~ 0.00018 grados
    const speed = gpsSpeedFromFix([42.00018, -8.0], 3000, 8);
    assert.ok(speed > 30 && speed < 40, `Velocidad esperada ~36 km/h, obtenida: ${speed}`);

    // Ruido parado (< 4 metros en 1 segundo): debe dar 0 km/h
    const jitterSpeed = gpsSpeedFromFix([42.00019, -8.0], 4000, 8);
    assert.equal(jitterSpeed, 0);

    // Salto imposible de GPS (> 90 km/h = 25 m/s): 1000 metros en 1 segundo -> da 0 km/h
    const jumpSpeed = gpsSpeedFromFix([42.01000, -8.0], 5000, 8);
    assert.equal(jumpSpeed, 0);
});

test('isUsableAltitude filters invalid barometric or vertical GPS noise', () => {
    // Altitud imposible en la Tierra
    assert.equal(isUsableAltitude({ altitude: 10000, altitudeAccuracy: 5 }, null, 1), false);
    assert.equal(isUsableAltitude({ altitude: -600, altitudeAccuracy: 5 }, null, 1), false);
    assert.equal(isUsableAltitude({ altitude: NaN, altitudeAccuracy: 5 }, null, 1), false);

    // Precisión vertical deficiente (> 15 m)
    assert.equal(isUsableAltitude({ altitude: 500, altitudeAccuracy: 25 }, null, 1), false);

    // Salto vertical irreal (> 5 m/s de ascenso/descenso)
    const prev = { altitude: 500 };
    assert.equal(isUsableAltitude({ altitude: 550, altitudeAccuracy: 5 }, prev, 2), false); // 25 m/s

    // Lectura válida
    assert.equal(isUsableAltitude({ altitude: 502, altitudeAccuracy: 4 }, prev, 2), true); // 1 m/s
    assert.equal(isUsableAltitude({ altitude: 450, altitudeAccuracy: 6 }, null, 0), true);
});

test('bearingBetween computes accurate compass azimuths', () => {
    // Hacia el Norte exacto: 0°
    const north = bearingBetween([0, 0], [1, 0]);
    assert.equal(Math.round(north), 0);

    // Hacia el Este exacto: 90°
    const east = bearingBetween([0, 0], [0, 1]);
    assert.equal(Math.round(east), 90);

    // Hacia el Sur exacto: 180°
    const south = bearingBetween([1, 0], [0, 0]);
    assert.equal(Math.round(south), 180);

    // Hacia el Oeste exacto: 270°
    const west = bearingBetween([0, 1], [0, 0]);
    assert.equal(Math.round(west), 270);
});

test('auto-pause and auto-resume thresholds adapt safely to GPS accuracy', () => {
    // Con precisión excelente (5 m)
    const pause5 = autoPauseMovementThreshold(5);
    const resume5 = autoResumeMovementThreshold(5);
    assert.ok(pause5 >= 12, 'Umbral mínimo de pausa al menos 12 m');
    assert.ok(resume5 > pause5, 'Reanudación debe requerir más distancia que pausa para evitar oscilaciones');

    // Con precisión moderada (20 m)
    const pause20 = autoPauseMovementThreshold(20);
    const resume20 = autoResumeMovementThreshold(20);
    assert.ok(pause20 <= 30, 'Umbral máximo de pausa acotado a 30 m');
    assert.ok(resume20 <= 35, 'Umbral máximo de reanudación acotado a 35 m');
    assert.ok(resume20 >= pause20);
});

test('GPS tracking options configure high accuracy appropriately', () => {
    assert.equal(GPS_ACTIVE_OPTIONS.enableHighAccuracy, true);
    assert.equal(GPS_ACTIVE_OPTIONS.maximumAge, 0);
    assert.equal(GPS_LOW_POWER_OPTIONS.enableHighAccuracy, false);
    assert.equal(GPS_LOW_POWER_OPTIONS.maximumAge, 10000);
});

test('recording requires a signed-in account with a nickname', () => {
    const cloud = (logged, nickname) => ({ loggedIn: () => logged, nickname });
    assert.equal(rideAccountRequirement(null), 'login');
    assert.equal(rideAccountRequirement(cloud(false, 'Emilio')), 'login');
    assert.equal(rideAccountRequirement(cloud(true, '')), 'nickname');
    assert.equal(rideAccountRequirement(cloud(true, '   ')), 'nickname');
    assert.equal(rideAccountRequirement(cloud(true, 'Emilio')), null);
});
