'use strict';

//  AVISO DE DESVÍO
// ============================================================
const ROUTE_GLOBAL_RESCAN_INTERVAL_MS = 5000;

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

function buildRouteCumulativeDistances(points, breakBefore = []) {
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
        const startsNewSegment = !Array.isArray(points[i - 1])
            || !Array.isArray(points[i])
            || breakBefore[i];
        cumulative.push(cumulative[i - 1]
            + (startsNewSegment ? 0 : dist(points[i - 1], points[i])));
    }
    return cumulative;
}

function routePointAtDistance(points, cumulative, distance, first = 0, last = cumulative.length - 1) {
    if (distance <= cumulative[first]) return points[first];
    if (distance >= cumulative[last]) return points[last];
    let low = first, high = last;
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

function buildRouteManeuvers(points, cumulative, breakBefore = []) {
    const sampleDistance = 18;
    const minAngle = 45;
    const minSeparation = 20;
    const candidates = [];
    let segmentStart = 0;
    for (let boundary = 0; boundary <= points.length; boundary++) {
        const startsNewSegment = boundary < points.length
            && boundary > segmentStart
            && breakBefore[boundary];
        if (boundary < points.length
            && Array.isArray(points[boundary])
            && !startsNewSegment) continue;

        const segmentEnd = boundary - 1;
        if (segmentEnd - segmentStart >= 2) {
            const segmentStartDistance = cumulative[segmentStart];
            const segmentEndDistance = cumulative[segmentEnd];
            for (let i = segmentStart + 1; i < segmentEnd; i++) {
                const distance = cumulative[i];
                if (distance - segmentStartDistance < sampleDistance
                    || segmentEndDistance - distance < sampleDistance) continue;
                const before = routePointAtDistance(
                    points, cumulative, distance - sampleDistance, segmentStart, segmentEnd
                );
                const after = routePointAtDistance(
                    points, cumulative, distance + sampleDistance, segmentStart, segmentEnd
                );
                const incoming = bearingBetween(before, points[i]);
                const outgoing = bearingBetween(points[i], after);
                const angle = ((outgoing - incoming + 540) % 360) - 180;
                if (Math.abs(angle) < minAngle || Math.abs(angle) >= 160) continue;
                const candidate = {
                    distanceMeters: distance,
                    segmentId: segmentStart,
                    direction: angle > 0 ? 'derecha' : 'izquierda',
                    angle: Math.abs(angle)
                };
                const previous = candidates[candidates.length - 1];
                if (previous && previous.segmentId === candidate.segmentId
                    && candidate.distanceMeters - previous.distanceMeters < minSeparation) {
                    if (candidate.angle > previous.angle) candidates[candidates.length - 1] = candidate;
                } else {
                    candidates.push(candidate);
                }
            }
        }
        segmentStart = boundary < points.length && Array.isArray(points[boundary])
            ? boundary
            : boundary + 1;
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
    const position = [lat, lon];
    const scan = (from, to) => {
        let bestIndex = null;
        let bestDistance = Infinity;
        for (let i = from; i <= to; i++) {
            if (!Array.isArray(pts[i]) || !Array.isArray(pts[i + 1])
                || (followedRoute.breakBefore && followedRoute.breakBefore[i + 1])) continue;
            const distance = pointSegDistM(position, pts[i], pts[i + 1]);
            if (distance < bestDistance) {
                bestIndex = i;
                bestDistance = distance;
            }
        }
        return bestIndex === null ? null : {
            index: bestIndex,
            distance: bestDistance,
            segmentId: followedRoute.segmentIds ? followedRoute.segmentIds[bestIndex] : null
        };
    };

    let match = scan(Math.max(0, hint - 30), Math.min(lastSegment, hint + 180));
    if ((!match || match.distance > 250)
        && Date.now() - (followedRoute.lastGlobalScanAt || 0) >= ROUTE_GLOBAL_RESCAN_INTERVAL_MS) {
        const globalMatch = scan(0, lastSegment);
        followedRoute.lastGlobalScanAt = Date.now();
        if (globalMatch) match = globalMatch;
    }
    if (!match) return null;
    match.fraction = pointSegFraction(position, pts[match.index], pts[match.index + 1]);
    followedRoute.progressIndex = match.index;
    return match;
}

function checkUpcomingRouteTurn(match) {
    if (!followedRoute || !match || match.distance > OFFROUTE_M) return;
    const cumulative = followedRoute.cumulativeMeters;
    const segmentLength = cumulative[match.index + 1] - cumulative[match.index];
    const progress = cumulative[match.index] + segmentLength * match.fraction;
    const segmentId = match.segmentId ?? (followedRoute.segmentIds
        ? followedRoute.segmentIds[match.index]
        : null);
    const maneuvers = followedRoute.maneuvers;
    while (followedRoute.nextManeuverWakeIndex < maneuvers.length) {
        const maneuver = maneuvers[followedRoute.nextManeuverWakeIndex];
        if (segmentId !== null && Number.isInteger(maneuver.segmentId)
            && maneuver.segmentId !== segmentId) {
            if (maneuver.segmentId < segmentId) {
                followedRoute.nextManeuverWakeIndex++;
                continue;
            }
            break;
        }
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
        if (segmentId !== null && Number.isInteger(maneuver.segmentId)
            && maneuver.segmentId !== segmentId) {
            if (maneuver.segmentId < segmentId) {
                followedRoute.nextManeuverIndex++;
                continue;
            }
            return;
        }
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

    const elevationTracker = MTBStatisticsEngine.createElevationTracker();
    const valid = [];
    points.forEach((point, index) => {
        if (index > 0 && Array.isArray(point) && point[5] === 1) elevationTracker.reset();
        const altitude = Array.isArray(point) && point[2] != null ? Number(point[2]) : null;
        const smoothedAltitude = elevationTracker.add(altitude);
        if (smoothedAltitude !== null) valid.push({ i: index, z: smoothedAltitude });
    });
    if (valid.length < 2) {
        $('map-route-alt').textContent = 'Sin datos de altitud';
        $('map-route-area').setAttribute('d', '');
        $('map-route-line').setAttribute('d', '');
        $('map-route-cursor-line').style.display = 'none';
        $('map-route-cursor').style.display = 'none';
        panel.classList.add('show');
        if (typeof mapPanelSyncRouteProfile === 'function') mapPanelSyncRouteProfile();
        return;
    }

    let min = Infinity, max = -Infinity;
    for (const point of valid) {
        if (point.z < min) min = point.z;
        if (point.z > max) max = point.z;
    }
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
    if (typeof mapPanelSyncRouteProfile === 'function') mapPanelSyncRouteProfile();
}

function updateMapRouteProfilePosition(match) {
    if (!followedRoute || !match || !routeProfileCoords.length || !routeProfilePointCount) return;
    const bestIndex = match.index;
    const x = bestIndex / Math.max(routeProfilePointCount - 1, 1) * 320;
    if (!isRecording && followedRoute.gainCum) $('m-elevation').textContent = Math.round(followedRoute.gainCum[bestIndex] || 0);
    let low = 0, high = routeProfileCoords.length - 1;
    while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (routeProfileCoords[middle].i < bestIndex) low = middle;
        else high = middle;
    }
    const before = routeProfileCoords[low], after = routeProfileCoords[high];
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
    // Volver al mapa antes de preparar capas/perfil: cualquier detalle de la ruta
    // debe cargarse sin dejar al usuario atrapado en Rutas o Comunidad.
    goToPage(0);
    unlockOffRouteSound();
    clearLastRideMapPreview();
    const points = r.points.map(p => Array.isArray(p) ? [p[0], p[1]] : null);
    const breakBefore = r.points.map((p, index) => index > 0
        && (!Array.isArray(p) || p[5] === 1 || !Array.isArray(r.points[index - 1])));
    let segmentId = null;
    const segmentIds = points.map((point, index) => {
        if (!Array.isArray(point)) {
            segmentId = null;
            return null;
        }
        if (segmentId === null || breakBefore[index]) segmentId = index;
        return segmentId;
    });
    const cumulativeMeters = buildRouteCumulativeDistances(points, breakBefore);
    followedRoute = {
        id: r.id,
        name: r.name,
        kind: r.kind,
        pts: points,
        breakBefore,
        segmentIds,
        cumulativeMeters,
        maneuvers: buildRouteManeuvers(points, cumulativeMeters, breakBefore),
        nextManeuverIndex: 0,
        nextManeuverWakeIndex: 0,
        pois: Array.isArray(r.pois) ? r.pois : [],
        gainCum: gainCumulative(r.points),
        progressIndex: 0,
        lastGlobalScanAt: 0
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
    if (typeof mapPanelSyncActions === 'function') mapPanelSyncActions();
    if (typeof mapPanelSetExpanded === 'function') mapPanelSetExpanded(true);
    if (typeof mapSideControlsScheduleAutoCollapse === 'function') mapSideControlsScheduleAutoCollapse();
    refreshGpsMode();
    toast(`Ruta preparada: «${r.name}». Inicia la actividad cuando quieras.`, 4500);
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
    if (typeof mapPanelSyncActions === 'function') mapPanelSyncActions();
    if (!isRecording) $('m-elevation').textContent = '0';
    refreshGpsMode();
}
// ============================================================
