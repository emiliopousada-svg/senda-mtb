'use strict';

//  AVISO DE DESVÍO
// ============================================================
function pointSegDistM(p, a, b) { // metros de p al segmento a-b (proyección local)
    const k = Math.cos(p[0] * Math.PI / 180);
    const ax = (a[1] - p[1]) * k * 111320, ay = (a[0] - p[0]) * 110540;
    const bx = (b[1] - p[1]) * k * 111320, by = (b[0] - p[0]) * 110540;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? -(ax * dx + ay * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx, ay + t * dy);
}

function unlockOffRouteSound() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
        if (!offRouteAudioContext) offRouteAudioContext = new AudioContextCtor();
        if (offRouteAudioContext.state === 'suspended') offRouteAudioContext.resume().catch(() => {});
    } catch (e) {}
}

function playRouteSound(frequencies) {
    if (localStorage.getItem('mtb_pro_route_sound') === '0') return;
    const ctx = offRouteAudioContext;
    if (!ctx || ctx.state !== 'running') return;
    const start = ctx.currentTime;
    frequencies.forEach((frequency, i) => {
        const at = start + i * 0.22;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.17);
    });
}

function playOffRouteSound() { playRouteSound([880, 660]); }
function playBackOnRouteSound() { playRouteSound([660, 880, 1040]); }

function announceRouteVoice(message) {
    if (localStorage.getItem('mtb_pro_route_voice') === '0') return;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') return;
    try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = 'es-ES';
        utterance.rate = 1.05;
        utterance.pitch = 1;
        utterance.volume = 1.0;
        window.speechSynthesis.speak(utterance);
    } catch (error) {
        console.warn('No se pudo emitir el aviso de navegación por voz:', error);
    }
}

function routeHaversineMeters(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad;
    const dLon = (b[1] - a[1]) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, s)));
}

function routeBearingBetween(from, to) {
    const rad = Math.PI / 180;
    const lat1 = from[0] * rad, lat2 = to[0] * rad;
    const dLon = (to[1] - from[1]) * rad;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function calculateRouteCumulativeDistances(pts) {
    if (!Array.isArray(pts) || !pts.length) return new Float64Array(0);
    const cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) {
        cum[i] = cum[i - 1] + routeHaversineMeters(pts[i - 1], pts[i]);
    }
    return cum;
}

function detectRouteTurns(pts, cumDist) {
    if (!Array.isArray(pts) || pts.length < 5 || !cumDist || cumDist.length < pts.length) return [];
    const turns = [];
    const totalDist = cumDist[pts.length - 1];
    if (totalDist < 50) return [];

    const windowM = 22; // muestreo hacia atrás y hacia adelante para filtrar micro-quiebros
    let lastTurnDistM = -100;

    for (let i = 1; i < pts.length - 1; i++) {
        const curDist = cumDist[i];
        if (curDist - lastTurnDistM < 45) continue; // no duplicar giros en la misma curva

        // Buscar punto ~windowM atrás
        let prevIdx = i;
        while (prevIdx > 0 && curDist - cumDist[prevIdx] < windowM) {
            prevIdx--;
        }

        // Buscar punto ~windowM adelante
        let nextIdx = i;
        while (nextIdx < pts.length - 1 && cumDist[nextIdx] - curDist < windowM) {
            nextIdx++;
        }

        if (curDist - cumDist[prevIdx] < 12 || cumDist[nextIdx] - curDist < 12) continue;

        const bearingIn = routeBearingBetween(pts[prevIdx], pts[i]);
        const bearingOut = routeBearingBetween(pts[i], pts[nextIdx]);
        const diff = (bearingOut - bearingIn + 540) % 360 - 180;

        let turnText = null;
        let turnType = null;

        if (diff >= 115) {
            turnType = 'sharp-right';
            turnText = 'curva muy cerrada a la derecha';
        } else if (diff >= 42) {
            turnType = 'right';
            turnText = 'giro a la derecha';
        } else if (diff <= -115) {
            turnType = 'sharp-left';
            turnText = 'curva muy cerrada a la izquierda';
        } else if (diff <= -42) {
            turnType = 'left';
            turnText = 'giro a la izquierda';
        }

        if (turnText) {
            turns.push({
                index: i,
                distanceM: curDist,
                angle: Math.round(diff),
                type: turnType,
                text: turnText,
                warnedAhead: false,
                warnedNow: false
            });
            lastTurnDistM = curDist;
        }
    }
    return turns;
}

function checkTurnVoicePrompts(currentDistanceM) {
    if (!followedRoute || !Array.isArray(followedRoute.turns) || !Number.isFinite(currentDistanceM)) return;
    for (const turn of followedRoute.turns) {
        const distRemaining = turn.distanceM - currentDistanceM;
        // Aviso previo: entre 45 y 75 metros
        if (!turn.warnedAhead && distRemaining <= 70 && distRemaining >= 40) {
            turn.warnedAhead = true;
            announceRouteVoice(`En ${Math.round(distRemaining)} metros, ${turn.text}.`);
            break;
        }
        // Aviso en el punto: entre 0 y 16 metros
        if (!turn.warnedNow && distRemaining <= 16 && distRemaining >= -5) {
            turn.warnedNow = true;
            announceRouteVoice(`${turn.text} ahora.`);
            break;
        }
    }
}

function findFollowedRouteMatch(lat, lon) {
    const pts = followedRoute && followedRoute.pts;
    if (!pts || pts.length < 2) return null;

    const lastSegment = pts.length - 2;
    const hint = Number.isInteger(followedRoute.progressIndex) ? followedRoute.progressIndex : 0;
    const scan = (from, to) => {
        let best = { index: from, distance: Infinity };
        for (let i = from; i <= to; i++) {
            const distance = pointSegDistM([lat, lon], pts[i], pts[i + 1]);
            if (distance < best.distance) best = { index: i, distance };
        }
        return best;
    };

    let match = scan(Math.max(0, hint - 30), Math.min(lastSegment, hint + 180));
    // Al empezar lejos de la ruta o tras un salto GPS, buscar el trazado completo.
    if (match.distance > 250) match = scan(0, lastSegment);
    followedRoute.progressIndex = match.index;
    return match;
}

function checkOffRoute(lat, lon, match) {
    if (!followedRoute || !match) return;
    const min = match.distance;
    if (!offRouteState && min > OFFROUTE_M) {
        offRouteState = true;
        toast(`⚠️ Te has salido de la ruta (${Math.round(min)} m)`, 5000);
        announceRouteVoice(`Atención. Estás a unos ${Math.round(min)} metros fuera de la ruta. Comprueba el mapa cuando sea seguro.`);
        playOffRouteSound();
        if (navigator.vibrate && localStorage.getItem('mtb_pro_route_vibration') !== '0') navigator.vibrate([200, 100, 200]);
    } else if (offRouteState && min < BACKONROUTE_M) {
        offRouteState = false;
        toast('✅ De nuevo en la ruta');
        announceRouteVoice('Has vuelto a la ruta.');
        playBackOnRouteSound();
    }
}

function renderMapRouteProfile(r) {
    const panel = $('map-route-profile');
    const points = Array.isArray(r.points) ? r.points : [];
    routeProfileCoords = [];
    routeProfilePointCount = points.length;
    $('map-route-name').textContent = r.name || 'Ruta cargada';

    const valid = points.map((p, i) => ({ i, z: p[2] == null ? NaN : Number(p[2]) }))
        .filter(p => Number.isFinite(p.z));
    if (valid.length < 2) {
        $('map-route-alt').textContent = 'Sin datos de altitud';
        $('map-route-area').setAttribute('d', '');
        $('map-route-line').setAttribute('d', '');
        $('map-route-cursor-line').style.display = 'none';
        $('map-route-cursor').style.display = 'none';
        panel.classList.add('show');
        return;
    }

    const min = Math.min(...valid.map(p => p.z));
    const max = Math.max(...valid.map(p => p.z));
    const range = Math.max(max - min, 1);
    routeProfileCoords = valid.map(p => ({
        i: p.i,
        x: routeProfilePointCount > 1 ? p.i / (routeProfilePointCount - 1) * 320 : 0,
        y: 53 - ((p.z - min) / range) * 42
    }));
    const line = routeProfileCoords.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    $('map-route-line').setAttribute('d', line);
    $('map-route-area').setAttribute('d', `${line} L320,60 L0,60 Z`);
    const gain = Number(r.elevationGain) || 0;
    $('map-route-alt').textContent = `${Math.round(min)}–${Math.round(max)} m · +${Math.round(gain)} m`;
    panel.classList.add('show');
}

function updateMapRouteProfilePosition(match) {
    if (!followedRoute || !match || !routeProfileCoords.length || !routeProfilePointCount) return;
    const bestIndex = match.index;
    const x = bestIndex / Math.max(routeProfilePointCount - 1, 1) * 320;
    if (!isRecording && followedRoute.gainCum) $('m-elevation').textContent = Math.round(followedRoute.gainCum[bestIndex] || 0);
    let before = routeProfileCoords[0], after = routeProfileCoords[routeProfileCoords.length - 1];
    for (let i = 1; i < routeProfileCoords.length; i++) {
        if (routeProfileCoords[i].i >= bestIndex) {
            before = routeProfileCoords[i - 1];
            after = routeProfileCoords[i];
            break;
        }
    }
    const span = after.i - before.i;
    const t = span ? Math.max(0, Math.min(1, (bestIndex - before.i) / span)) : 0;
    const y = before.y + (after.y - before.y) * t;
    const line = $('map-route-cursor-line'), dot = $('map-route-cursor');
    line.setAttribute('x1', x.toFixed(1)); line.setAttribute('x2', x.toFixed(1));
    dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1));
    line.style.display = 'block';
    dot.style.display = 'block';
}

function followRoute(r) {
    unlockOffRouteSound();
    clearLastRideMapPreview();
    const routePts = r.points.map(p => [p[0], p[1]]);
    const cumDist = calculateRouteCumulativeDistances(routePts);
    const turns = detectRouteTurns(routePts, cumDist);
    followedRoute = {
        id: r.id,
        name: r.name,
        kind: r.kind,
        pts: routePts,
        cumDist,
        turns,
        pois: Array.isArray(r.pois) ? r.pois : [],
        gainCum: gainCumulative(r.points),
        progressIndex: 0
    };
    // ── Mini ClimbPro: detectar subidas una sola vez ──────────
    if (typeof detectClimbs === 'function' && typeof setRouteClimbs === 'function') {
        try {
            const climbs = detectClimbs(r.points);
            setRouteClimbs(climbs);
            if (climbs.length > 0) {
                const totalGain = climbs.reduce((s, c) => s + c.gainM, 0);
                toast(`⛰️ ${climbs.length} subida${climbs.length > 1 ? 's' : ''} detectada${climbs.length > 1 ? 's' : ''} · +${Math.round(totalGain)} m desnivel`, 4000);
            }
        } catch (e) {
            console.warn('ClimbPro: error al detectar subidas', e);
        }
    }
    showRoutePoisOnMap([...(isRecording ? recordingPois : []), ...followedRoute.pois]);
    renderMapRouteProfile(r);
    if (lastLat !== null && lastLon !== null) {
        const match = findFollowedRouteMatch(lastLat, lastLon);
        updateMapRouteProfilePosition(match);
        checkOffRoute(lastLat, lastLon, match);
    }
    offRouteState = false;
    if (map) {
        savedRouteLayer.setLatLngs(buildSegments(r.points));
        const b = savedRouteLayer.getBounds();
        if (b.isValid()) map.fitBounds(b, { padding: [30, 30] });
        if (lastLat !== null && lastLon !== null) {
            map.setView([lastLat, lastLon], Math.max(16, Math.min(map.getMaxZoom(), map.getZoom())));
        }
        if (r.points.length >= 2 && lastLat !== null && lastLon !== null) {
            const routeHeading = routeHeadingFromFollowedRoute(followedRoute.progressIndex);
            if (routeHeading != null) {
                lastHeading = routeHeading;
                applyMapHeading(routeHeading);
            }
        }
        following = true;
        updateCenterBtn();
    }
    $('btn-unfollow').style.display = 'flex';
    goToPage(0);
    refreshGpsMode();
    toast(`Siguiendo «${r.name}». Te aviso si te desvías.`, 4500);
}

function unfollowRoute() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    followedRoute = null;
    showRoutePoisOnMap(isRecording ? recordingPois : []);
    routeProfileCoords = [];
    routeProfilePointCount = 0;
    offRouteState = false;
    if (savedRouteLayer) savedRouteLayer.setLatLngs([]);
    $('map-route-profile').classList.remove('show');
    $('btn-unfollow').style.display = 'none';
    if (!isRecording) $('m-elevation').textContent = '0';
    // ── Mini ClimbPro: limpiar subidas al dejar de seguir ─────
    if (typeof clearClimbProgress === 'function') clearClimbProgress();
    refreshGpsMode();
}
if (typeof $ === 'function' && $('btn-unfollow')) {
    $('btn-unfollow').addEventListener('click', () => { unfollowRoute(); toast('Has dejado de seguir la ruta.'); });
}

// ============================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        pointSegDistM,
        routeHaversineMeters,
        routeBearingBetween,
        calculateRouteCumulativeDistances,
        detectRouteTurns,
        checkTurnVoicePrompts
    };
}
