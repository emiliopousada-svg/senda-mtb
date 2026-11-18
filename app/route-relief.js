'use strict';

// Vista 3D tipo relieve del recorrido para la pantalla de Inicio.
// Usa solo los puntos de la ruta ([lat, lon, alt, tiempo, ..., corte]),
// así funciona sin conexión y sin descargar modelos de terreno.

const ROUTE_RELIEF_MAX_POINTS = 420;
const ROUTE_RELIEF_MIN_ALTITUDE_POINTS = 8;
const ROUTE_RELIEF_MIN_RANGE_M = 3;
const ROUTE_RELIEF_TARGET_HEIGHT = 0.3; // altura del relieve respecto al ancho del recorrido
const ROUTE_RELIEF_MAX_EXAGGERATION = 12;
const ROUTE_RELIEF_LOW = [22, 140, 255];   // azul eléctrico: zonas bajas
const ROUTE_RELIEF_HIGH = [255, 122, 26];  // naranja deportivo: zonas altas

/**
 * Convierte los puntos de una ruta en un modelo 3D normalizado.
 * Devuelve null si no hay suficientes coordenadas para dibujar el recorrido.
 */
function routeReliefModel(points) {
    const source = Array.isArray(points) ? points : [];
    const valid = [];
    source.forEach(point => {
        if (!Array.isArray(point)) return;
        const lat = Number(point[0]);
        const lon = Number(point[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        const altitude = point[2] === null || point[2] === undefined || point[2] === '' ? NaN : Number(point[2]);
        valid.push({ lat, lon, alt: Number.isFinite(altitude) ? altitude : null, brk: point[5] === 1 });
    });

    if (valid.length < 2) return null;
    const altitudeCount = valid.filter(point => point.alt !== null).length;

    // Rellena huecos de altitud con el último valor conocido (o el primero, al principio).
    const firstPointWithAltitude = valid.find(point => point.alt !== null);
    const firstAltitude = firstPointWithAltitude ? firstPointWithAltitude.alt : 0;
    let lastAltitude = firstAltitude;
    valid.forEach(point => {
        if (point.alt === null) point.alt = lastAltitude;
        else lastAltitude = point.alt;
    });

    // Muestreo uniforme conservando cortes de segmento, inicio y final.
    const step = Math.max(1, Math.ceil(valid.length / ROUTE_RELIEF_MAX_POINTS));
    const sampled = valid.filter((point, index) =>
        index % step === 0 || point.brk || index === valid.length - 1
    );

    let minAlt = Infinity, maxAlt = -Infinity;
    sampled.forEach(point => { minAlt = Math.min(minAlt, point.alt); maxAlt = Math.max(maxAlt, point.alt); });
    const range = maxAlt - minAlt;
    const hasElevation = altitudeCount >= ROUTE_RELIEF_MIN_ALTITUDE_POINTS
        && range >= ROUTE_RELIEF_MIN_RANGE_M;

    const lat0 = sampled.reduce((sum, point) => sum + point.lat, 0) / sampled.length;
    const metersPerDegLat = 110540;
    const metersPerDegLon = 111320 * Math.max(0.01, Math.cos(lat0 * Math.PI / 180));
    const metric = sampled.map(point => ({
        x: point.lon * metersPerDegLon,
        y: point.lat * metersPerDegLat,
        alt: point.alt,
        brk: point.brk
    }));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    metric.forEach(point => {
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    });
    const extent = Math.max(maxX - minX, maxY - minY, 1);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Exageración vertical: al menos el relieve real, como máximo ×12.
    const exaggeration = hasElevation
        ? Math.min(ROUTE_RELIEF_MAX_EXAGGERATION,
            Math.max(1, (ROUTE_RELIEF_TARGET_HEIGHT * extent) / range))
        : 1;

    const nodes = metric.map(point => ({
        x: (point.x - centerX) / extent,
        y: (point.y - centerY) / extent,
        // Sin altitud fiable, eleva ligeramente el trazado sobre el plano para
        // mantener la presentación isométrica sin fingir variaciones del terreno.
        z: hasElevation ? ((point.alt - minAlt) * exaggeration) / extent : 0.035,
        t: hasElevation ? (point.alt - minAlt) / range : 0.5,
        brk: point.brk
    }));

    return {
        nodes,
        hasElevation,
        minAlt: Math.round(minAlt),
        maxAlt: Math.round(maxAlt),
        exaggeration: Math.round(exaggeration * 10) / 10,
        halfWidth: (maxX - minX) / extent / 2,
        halfDepth: (maxY - minY) / extent / 2,
        zMax: hasElevation ? (range * exaggeration) / extent : 0.035
    };
}

function routeReliefColor(t, alpha = 1) {
    const k = Math.max(0, Math.min(1, t));
    const [r, g, b] = ROUTE_RELIEF_LOW.map((low, index) => Math.round(low + (ROUTE_RELIEF_HIGH[index] - low) * k));
    return `rgba(${r},${g},${b},${alpha})`;
}

// Color opaco de la pared: mezcla el color de altitud con el fondo del panel.
function routeReliefWallColor(t, amount) {
    const ground = [20, 30, 26];
    const k = Math.max(0, Math.min(1, t));
    const color = ROUTE_RELIEF_LOW.map((low, index) => low + (ROUTE_RELIEF_HIGH[index] - low) * k);
    const [r, g, b] = color.map((value, index) => Math.round(ground[index] + (value - ground[index]) * amount));
    return `rgb(${r},${g},${b})`;
}

/**
 * Proyecta un punto del modelo con la cámara (giro y elevación en grados).
 * depth crece hacia el observador: se pinta de menor a mayor.
 */
function routeReliefProject(node, view) {
    const yaw = view.yaw * Math.PI / 180;
    const tilt = view.tilt * Math.PI / 180;
    const xr = node.x * Math.cos(yaw) - node.y * Math.sin(yaw);
    const yr = node.x * Math.sin(yaw) + node.y * Math.cos(yaw);
    return {
        x: xr,
        y: -yr * Math.sin(tilt) - node.z * Math.cos(tilt),
        depth: -yr * Math.cos(tilt) + node.z * Math.sin(tilt)
    };
}

function routeReliefDraw(canvas, model, view) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Escala estable al girar: se ajusta al círculo que contiene la base.
    const radius = Math.hypot(model.halfWidth, model.halfDepth) || 0.5;
    const tilt = view.tilt * Math.PI / 180;
    const sceneWidth = radius * 2;
    const sceneHeight = radius * 2 * Math.sin(tilt) + model.zMax * Math.cos(tilt);
    const padX = 22, padTop = 34, padBottom = 18;
    const scale = Math.min((width - padX * 2) / sceneWidth, (height - padTop - padBottom) / sceneHeight);
    const offsetX = width / 2;
    const offsetY = padTop + ((height - padTop - padBottom) - sceneHeight * scale) / 2
        + (model.zMax * Math.cos(tilt) + radius * Math.sin(tilt)) * scale;
    const toScreen = projected => [offsetX + projected.x * scale, offsetY + projected.y * scale];

    // Suelo: rectángulo de la zona con una retícula suave.
    const gridPad = 0.06;
    const hw = model.halfWidth + gridPad, hd = model.halfDepth + gridPad;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
        .map(([x, y]) => toScreen(routeReliefProject({ x, y, z: 0 }, view)));
    ctx.beginPath();
    corners.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(20, 30, 26, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(143, 166, 199, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(143, 166, 199, 0.09)';
    const lines = 8;
    for (let i = 1; i < lines; i += 1) {
        const fx = -hw + (2 * hw * i) / lines;
        const fy = -hd + (2 * hd * i) / lines;
        [[{ x: fx, y: -hd }, { x: fx, y: hd }], [{ x: -hw, y: fy }, { x: hw, y: fy }]].forEach(([a, b]) => {
            const [ax, ay] = toScreen(routeReliefProject({ ...a, z: 0 }, view));
            const [bx, by] = toScreen(routeReliefProject({ ...b, z: 0 }, view));
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        });
    }
    ctx.restore();

    const nodes = model.nodes;
    const top = nodes.map(node => routeReliefProject(node, view));
    const base = nodes.map(node => routeReliefProject({ ...node, z: 0 }, view));

    // Sombra del recorrido sobre el suelo.
    ctx.beginPath();
    base.forEach((point, index) => {
        const [x, y] = toScreen(point);
        if (index === 0 || nodes[index].brk) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Pared del perfil: tramos ordenados de atrás hacia delante.
    const quads = [];
    for (let i = 1; i < nodes.length; i += 1) {
        if (nodes[i].brk) continue;
        quads.push({ i, depth: (top[i - 1].depth + top[i].depth + base[i - 1].depth + base[i].depth) / 4 });
    }
    quads.sort((a, b) => a.depth - b.depth);
    quads.forEach(({ i }) => {
        const [ax, ay] = toScreen(top[i - 1]);
        const [bx, by] = toScreen(top[i]);
        const [cx, cy] = toScreen(base[i]);
        const [dx, dy] = toScreen(base[i - 1]);
        const t = (nodes[i - 1].t + nodes[i].t) / 2;
        const gradient = ctx.createLinearGradient(0, Math.min(ay, by), 0, Math.max(cy, dy));
        gradient.addColorStop(0, routeReliefWallColor(t, 0.58));
        gradient.addColorStop(1, routeReliefWallColor(t, 0.04));
        ctx.beginPath();
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
        // Pared opaca: un trazo fino del mismo color tapa las juntas entre tramos.
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 0.75;
        ctx.stroke();
    });

    // Línea del recorrido coloreada por altitud.
    ctx.lineCap = 'round';
    for (let i = 1; i < nodes.length; i += 1) {
        if (nodes[i].brk) continue;
        const [ax, ay] = toScreen(top[i - 1]);
        const [bx, by] = toScreen(top[i]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        ctx.strokeStyle = routeReliefColor((nodes[i - 1].t + nodes[i].t) / 2);
        ctx.lineWidth = 2.6;
        ctx.stroke();
    }

    // Inicio (anillo) y final (punto) con su vertical hasta el suelo.
    [[0, false], [nodes.length - 1, true]].forEach(([index, isEnd]) => {
        const [tx, ty] = toScreen(top[index]);
        const [bx, by] = toScreen(base[index]);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty);
        ctx.strokeStyle = 'rgba(240, 243, 247, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(tx, ty, isEnd ? 5 : 5.5, 0, Math.PI * 2);
        if (isEnd) { ctx.fillStyle = '#f0f3f7'; ctx.fill(); }
        else { ctx.fillStyle = '#111318'; ctx.fill(); ctx.strokeStyle = '#f0f3f7'; ctx.lineWidth = 2; ctx.stroke(); }
    });
}

/**
 * Crea el relieve 3D con altitudes GPS o una vista isométrica del trazado si faltan.
 */
function createRouteRelief3D(route) {
    const model = routeReliefModel(route && route.points);
    if (!model) return null;

    const container = document.createElement('div');
    container.className = 'route-relief';
    const canvas = document.createElement('canvas');
    canvas.className = 'route-relief-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label',
        (model.hasElevation
            ? `Relieve 3D de ${route.name || 'la ruta'}: altitud entre ${model.minAlt} y ${model.maxAlt} m. `
            : `Vista 3D del trazado de ${route.name || 'la ruta'}; altitud GPS no disponible. `)
        + 'Arrastra o usa las flechas para girarlo.');

    const badge = document.createElement('span');
    badge.className = 'route-relief-badge';
    badge.textContent = !model.hasElevation
        ? '3D · altitud sin datos'
        : model.exaggeration > 1.05 ? `3D · relieve ×${model.exaggeration}` : '3D · relieve real';
    badge.title = 'La altura se exagera para que el desnivel se aprecie';

    const legend = document.createElement('span');
    legend.className = 'route-relief-legend';
    legend.innerHTML = '<i aria-hidden="true"></i>';
    const legendText = document.createElement('span');
    legendText.textContent = model.hasElevation ? `${model.minAlt}–${model.maxAlt} m` : 'Sin datos de altitud';
    legend.appendChild(legendText);

    const hint = document.createElement('span');
    hint.className = 'route-relief-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = 'Arrastra para girar';

    container.append(canvas, badge, legend, hint);

    const reduceMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const view = { yaw: reduceMotion ? -32 : -62, tilt: 34 };
    let frame = 0;
    const draw = () => {
        frame = 0;
        if (canvas.isConnected) routeReliefDraw(canvas, model, view);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };

    // Giro con el dedo o el ratón: horizontal gira, vertical cambia la inclinación.
    let drag = null;
    canvas.addEventListener('pointerdown', event => {
        drag = { x: event.clientX, y: event.clientY, yaw: view.yaw, tilt: view.tilt };
        canvas.setPointerCapture?.(event.pointerId);
        container.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', event => {
        if (!drag) return;
        view.yaw = drag.yaw + (event.clientX - drag.x) * 0.5;
        view.tilt = Math.max(14, Math.min(72, drag.tilt + (event.clientY - drag.y) * 0.25));
        schedule();
    });
    const endDrag = () => { drag = null; container.classList.remove('dragging'); };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('keydown', event => {
        const keys = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
        const delta = keys[event.key];
        if (!delta) return;
        event.preventDefault();
        view.yaw += delta[0];
        view.tilt = Math.max(14, Math.min(72, view.tilt + delta[1]));
        schedule();
    });

    if (typeof ResizeObserver === 'function') new ResizeObserver(schedule).observe(canvas);
    requestAnimationFrame(draw);

    // Breve giro de entrada (una sola vez, sin animación continua).
    if (!reduceMotion) {
        const start = performance.now();
        const from = view.yaw, to = -32, duration = 1400;
        const intro = now => {
            if (drag || !canvas.isConnected) return;
            const k = Math.min(1, (now - start) / duration);
            view.yaw = from + (to - from) * (1 - Math.pow(1 - k, 3));
            draw();
            if (k < 1) requestAnimationFrame(intro);
        };
        requestAnimationFrame(intro);
    }

    container.routeReliefKey = routeReliefKey(route);
    return container;
}

function routeReliefKey(route) {
    const points = route && Array.isArray(route.points) ? route.points : [];
    const last = points[points.length - 1];
    return [route && route.id, points.length, last && last[3]].join('|');
}
