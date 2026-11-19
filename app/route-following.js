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

function pointSegFraction(p, a, b) {
    const k = Math.cos(p[0] * Math.PI / 180);
    const ax = (a[1] - p[1]) * k * 111320, ay = (a[0] - p[0]) * 110540;
    const bx = (b[1] - p[1]) * k * 111320, by = (b[0] - p[0]) * 110540;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (!l2) return 0;
    return Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
}

function buildRouteCumulativeDistances(points) {
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
        cumulative.push(cumulative[i - 1] + dist(points[i - 1], points[i]));
    }
    return cumulative;
}

function routePointAtDistance(points, cumulative, distance) {
    if (distance <= 0) return points[0];
    const last = cumulative.length - 1;
    if (distance >= cumulative[last]) return points[last];
    let low = 0, high = last;
    while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (cumulative[middle] < distance) low = middle;
        else high = middle;
    }
    const segmentLength = cumulative[high] - cumulative[low];
    const fraction = segmentLength ? (distance - cumulative[low]) / segmentLength : 0;
    return [
        points[low][0] + (points[high][0] - points[low][0]) * fraction,
        points[low][1] + (points[high][1] - points[low][1]) * fraction
    ];
}

function buildRouteManeuvers(points, cumulative) {
    const sampleDistance = 18;
    const minAngle = 45;
    const minSeparation = 20;
    const candidates = [];
    for (let i = 1; i < points.length - 1; i++) {
        const distance = cumulative[i];
        if (distance < sampleDistance || cumulative[cumulative.length - 1] - distance < sampleDistance) continue;
        const before = routePointAtDistance(points, cumulative, distance - sampleDistance);
        const after = routePointAtDistance(points, cumulative, distance + sampleDistance);
        const incoming = bearingBetween(before, points[i]);
        const outgoing = bearingBetween(points[i], after);
        const angle = ((outgoing - incoming + 540) % 360) - 180;
        if (Math.abs(angle) < minAngle || Math.abs(angle) >= 160) continue;
        const candidate = {
            distanceMeters: distance,
            direction: angle > 0 ? 'derecha' : 'izquierda',
            angle: Math.abs(angle)
        };
        const previous = candidates[candidates.length - 1];
        if (previous && candidate.distanceMeters - previous.distanceMeters < minSeparation) {
            if (candidate.angle > previous.angle) candidates[candidates.length - 1] = candidate;
        } else {
            candidates.push(candidate);
        }
    }
    return candidates;
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
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 0.9;
        window.speechSynthesis.speak(utterance);
    } catch (error) {
        console.warn('No se pudo emitir el aviso de navegación por voz:', error);
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
    match.fraction = pointSegFraction([lat, lon], pts[match.index], pts[match.index + 1]);
    followedRoute.progressIndex = match.index;
    return match;
}

function checkUpcomingRouteTurn(match) {
    if (!followedRoute || !match || match.distance > OFFROUTE_M) return;
    const cumulative = followedRoute.cumulativeMeters;
    const segmentLength = cumulative[match.index + 1] - cumulative[match.index];
    const progress = cumulative[match.index] + segmentLength * match.fraction;
    const maneuvers = followedRoute.maneuvers;
    while (followedRoute.nextManeuverWakeIndex < maneuvers.length) {
        const maneuver = maneuvers[followedRoute.nextManeuverWakeIndex];
        const remaining = maneuver.distanceMeters - progress;
        if (remaining < -15) {
            followedRoute.nextManeuverWakeIndex++;
            continue;
        }
        if (remaining > 40) break;
        followedRoute.nextManeuverWakeIndex++;
        if (typeof screenWakeForNavigation === 'function') screenWakeForNavigation();
        break;
    }
    while (followedRoute.nextManeuverIndex < maneuvers.length) {
        const maneuver = maneuvers[followedRoute.nextManeuverIndex];
        const remaining = maneuver.distanceMeters - progress;
        if (remaining < -15) {
            followedRoute.nextManeuverIndex++;
            continue;
        }
        if (remaining > 50) return;
        followedRoute.nextManeuverIndex++;
        const distanceText = remaining <= 15
            ? 'ahora'
            : `en ${Math.max(10, Math.round(remaining / 10) * 10)} metros`;
        announceRouteVoice(`Gira a la ${maneuver.direction} ${distanceText}.`);
        toast(`Giro a la ${maneuver.direction} ${distanceText}`, 4500);
        return;
    }
}

function checkOffRoute(lat, lon, match) {
    if (!followedRoute || !match) return;
    const min = match.distance;
    if (!offRouteState && min > OFFROUTE_M) {
        offRouteState = true;
        if (typeof screenWakeForNavigation === 'function') screenWakeForNavigation();
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
    const points = r.points.map(p => [p[0], p[1]]);
    const cumulativeMeters = buildRouteCumulativeDistances(points);
    followedRoute = {
        id: r.id,
        name: r.name,
        kind: r.kind,
        pts: points,
        cumulativeMeters,
        maneuvers: buildRouteManeuvers(points, cumulativeMeters),
        nextManeuverIndex: 0,
        nextManeuverWakeIndex: 0,
        pois: Array.isArray(r.pois) ? r.pois : [],
        gainCum: gainCumulative(r.points),
        progressIndex: 0
    };
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
    refreshGpsMode();
}
$('btn-unfollow').addEventListener('click', () => { unfollowRoute(); toast('Has dejado de seguir la ruta.'); });

// ============================================================
