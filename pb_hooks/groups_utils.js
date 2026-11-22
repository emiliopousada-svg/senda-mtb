// Utilidades de grupos. Se cargan con require() desde dentro de cada handler de groups.pb.js.
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const SAFE_INVITE_RE = /^[A-Z0-9]{12}$/;

function requireSafeValue(value, label, pattern = SAFE_ID_RE) {
    const str = String(value ?? "").trim();
    if (!str || !pattern.test(str)) {
        throw new Error(`${label} inválido`);
    }
    return str;
}

function requireNickname(value) {
    const nickname = String(value || "").trim().slice(0, 32);
    if (!nickname) throw new Error("Añade un apodo a tu cuenta para que los miembros del grupo puedan identificarte.");
    return nickname;
}

function safeMembership(groupId, userId, app = $app) {
    const safeGroupId = requireSafeValue(groupId, "groupId");
    const safeUserId = requireSafeValue(userId, "userId");
    return app.findRecordsByFilter("mtb_group_members", "group = {:group} && user = {:user}", "", 1, 0, { group: safeGroupId, user: safeUserId });
}

function findRecordsByIds(app, collection, ids) {
    const uniqueIds = Array.from(new Set(ids.map(id => requireSafeValue(id, "id"))));
    const records = [];
    const batchSize = 100;
    for (let offset = 0; offset < uniqueIds.length; offset += batchSize) {
        const batch = uniqueIds.slice(offset, offset + batchSize);
        const params = {};
        const clauses = batch.map((id, index) => {
            const key = `id${index}`;
            params[key] = id;
            return `id = {:${key}}`;
        });
        records.push(...app.findRecordsByFilter(collection, clauses.join(" || "), "", batch.length, 0, params));
    }
    return records;
}

function findAllRecordsByFilter(collection, filter, sort, app = $app) {
    const records = [];
    const pageSize = 200;
    let offset = 0;
    while (true) {
        const page = app.findRecordsByFilter(collection, filter, sort, pageSize, offset);
        records.push(...page);
        if (page.length < pageSize) return records;
        offset += page.length;
    }
}

function deleteAllRecordsByFilter(collection, filter, app = $app) {
    const batchSize = 200;
    let deleted = 0;
    while (true) {
        const batch = app.findRecordsByFilter(collection, filter, "", batchSize, 0);
        if (!batch.length) return deleted;
        for (const record of batch) {
            app.delete(record);
            deleted++;
        }
    }
}

const SEASON_DURATION_DAYS = 28;
const SEASON_DURATION_MS = SEASON_DURATION_DAYS * 24 * 60 * 60 * 1000;
const LEAGUE_EPOCH_MS = Date.UTC(2026, 0, 5); // Lunes 5 de enero de 2026 (origen de temporadas)

function getSeasonInfo(timestampMs = Date.now()) {
    const time = Number.isFinite(Number(timestampMs)) ? Number(timestampMs) : Date.now();
    const elapsed = Math.max(0, time - LEAGUE_EPOCH_MS);
    const seasonNumber = Math.floor(elapsed / SEASON_DURATION_MS) + 1;
    const startMs = LEAGUE_EPOCH_MS + (seasonNumber - 1) * SEASON_DURATION_MS;
    const endMs = startMs + SEASON_DURATION_MS - 1;
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const currentWeek = Math.min(4, Math.floor((time - startMs) / weekMs) + 1);
    const daysRemaining = Math.max(0, Math.ceil((endMs - time) / (24 * 60 * 60 * 1000)));

    return {
        seasonNumber,
        currentWeek,
        daysRemaining,
        startMs,
        endMs,
        startDate: new Date(startMs).toISOString().slice(0, 10),
        endDate: new Date(endMs).toISOString().slice(0, 10)
    };
}

function calculateActivityPoints(distanceKm, movingTimeSec, elevationGain) {
    const dist = Number(distanceKm);
    const time = Number(movingTimeSec);
    const elev = Number(elevationGain);
    if (!Number.isFinite(dist) || dist <= 0) return 0;

    // 1 pt por cada km recorrido (hasta 200 km por actividad)
    const distancePoints = Math.min(200, dist);

    // 1 pt por cada 50 m de desnivel positivo
    const elevationPoints = Number.isFinite(elev) && elev > 0 ? Math.floor(elev / 50) : 0;

    // 1 pt por cada 15 min en movimiento (900 s)
    const timePoints = Number.isFinite(time) && time > 0 ? Math.floor(time / 900) : 0;

    // Bonus de constancia: 10 pts si la salida es de al menos 10 km o 30 min
    const consistencyBonus = (dist >= 10 || (Number.isFinite(time) && time >= 1800)) ? 10 : 0;

    return Math.round(distancePoints + elevationPoints + timePoints + consistencyBonus);
}

function getEntryValue(entry, field, isNumeric = false) {
    if (entry && typeof entry.getFloat === "function" && isNumeric) return entry.getFloat(field);
    if (entry && typeof entry.getString === "function" && !isNumeric) return entry.getString(field);
    if (isNumeric) return Number(entry && entry[field]) || 0;
    return String((entry && entry[field]) || "");
}

// Fecha de la actividad compartida. El clientId de las salidas grabadas es Date.now()
// al guardarlas, así que es la mejor referencia; si no es plausible se usa "created".
const MIN_ACTIVITY_MS = Date.UTC(2020, 0, 1);
function entryTimeMs(entry, nowMs = Date.now()) {
    const clientId = getEntryValue(entry, "clientId", true);
    if (Number.isFinite(clientId) && clientId >= MIN_ACTIVITY_MS && clientId <= nowMs + 24 * 60 * 60 * 1000) {
        return clientId;
    }
    const created = Date.parse(String(getEntryValue(entry, "created", false)).replace(" ", "T"));
    return Number.isFinite(created) ? created : NaN;
}

function groupRankingSummaryFromEntries(entries, options = {}) {
    const season = options.season || null;
    const rankings = {};
    if (!Array.isArray(entries)) return rankings;

    entries.forEach((entry) => {
        if (season) {
            const entryTime = entryTimeMs(entry);
            if (!Number.isFinite(entryTime) || entryTime < season.startMs || entryTime > season.endMs) return;
        }

        const owner = getEntryValue(entry, "owner", false);
        if (!owner) return;

        const ranking = rankings[owner] || {
            maxDistanceKm: 0,
            distanceMovingTimeSec: 0,
            maxElevationGainM: 0,
            bestMovingTimeSec: 0,
            maxSpeedKmh: 0,
            activityCount: 0,
            totalDistanceKm: 0,
            totalElevationM: 0,
            leaguePoints: 0
        };

        const distanceKm = getEntryValue(entry, "distanceKm", true);
        const movingTimeSec = getEntryValue(entry, "movingTimeSec", true);
        const maxSpeedKmh = getEntryValue(entry, "maxSpeedKmh", true);
        const elevationGain = getEntryValue(entry, "elevationGain", true);

        if (distanceKm > ranking.maxDistanceKm) {
            ranking.maxDistanceKm = distanceKm;
            ranking.distanceMovingTimeSec = movingTimeSec;
        }
        if (elevationGain > ranking.maxElevationGainM) {
            ranking.maxElevationGainM = elevationGain;
        }
        if (movingTimeSec > ranking.bestMovingTimeSec) {
            ranking.bestMovingTimeSec = movingTimeSec;
        }
        if (maxSpeedKmh > ranking.maxSpeedKmh) {
            ranking.maxSpeedKmh = maxSpeedKmh;
        }

        ranking.activityCount++;
        ranking.totalDistanceKm += distanceKm;
        ranking.totalElevationM += elevationGain;
        ranking.leaguePoints += calculateActivityPoints(distanceKm, movingTimeSec, elevationGain);

        rankings[owner] = ranking;
    });
    return rankings;
}

// ------------------------------------------------------------
//  Liga de grupo: temporadas, desafíos, títulos y actividad
// ------------------------------------------------------------
const CHALLENGE_METRICS = {
    distance: { label: "km", maxTarget: 20000 },
    elevation: { label: "m de desnivel", maxTarget: 20000 },
    activities: { label: "salidas", maxTarget: 20000 },
    time: { label: "horas en movimiento", maxTarget: 20000 }
};
const CHALLENGE_MIN_TARGET = 10;
const CHALLENGE_MAX_DAYS = 120;
const CHALLENGE_MAX_ACTIVE = 20;

function getSeasonInfoByNumber(seasonNumber, nowMs = Date.now()) {
    const number = Math.max(1, Math.floor(Number(seasonNumber) || 1));
    const startMs = LEAGUE_EPOCH_MS + (number - 1) * SEASON_DURATION_MS;
    const info = getSeasonInfo(Math.min(Math.max(nowMs, startMs), startMs + SEASON_DURATION_MS - 1));
    info.finished = nowMs > info.endMs;
    return info;
}

function entryMetricValue(entry, metric) {
    if (metric === "distance") return getEntryValue(entry, "distanceKm", true);
    if (metric === "elevation") return getEntryValue(entry, "elevationGain", true);
    if (metric === "activities") return 1;
    if (metric === "time") return getEntryValue(entry, "movingTimeSec", true) / 3600;
    return 0;
}

function sortEntriesByTime(entries) {
    return (Array.isArray(entries) ? entries : [])
        .map(entry => ({ entry, time: entryTimeMs(entry) }))
        .filter(item => Number.isFinite(item.time))
        .sort((a, b) => a.time - b.time);
}

function validateChallengeInput(input, nowMs = Date.now()) {
    const name = String(input && input.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (name.length < 3) throw new Error("El desafío necesita un nombre de al menos 3 caracteres.");
    const metric = String(input && input.metric || "");
    const definition = CHALLENGE_METRICS[metric];
    if (!definition) throw new Error("Elige un tipo de desafío válido.");
    const target = Number(input && input.target);
    if (!Number.isFinite(target) || target < CHALLENGE_MIN_TARGET || target > definition.maxTarget) {
        throw new Error("La meta del desafío debe estar entre 10 y 20000.");
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const startsAtMs = input && input.startsAt ? Date.parse(String(input.startsAt)) : nowMs;
    const endsAtRaw = input && input.endsAt ? Date.parse(String(input.endsAt)) : NaN;
    if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtRaw)) throw new Error("Las fechas del desafío no son válidas.");
    // La fecha de fin es inclusiva: termina al final de ese día (UTC).
    const endsAtMs = /^\d{4}-\d{2}-\d{2}$/.test(String(input.endsAt)) ? endsAtRaw + dayMs - 1 : endsAtRaw;
    if (endsAtMs <= startsAtMs) throw new Error("La fecha de fin debe ser posterior al inicio.");
    if (endsAtMs < nowMs) throw new Error("La fecha de fin ya ha pasado.");
    if (startsAtMs < nowMs - 31 * dayMs) throw new Error("El inicio no puede ser anterior a hace 31 días.");
    if (endsAtMs - startsAtMs > CHALLENGE_MAX_DAYS * dayMs) throw new Error(`Un desafío puede durar como máximo ${CHALLENGE_MAX_DAYS} días.`);
    const roundedTarget = metric === "activities" ? Math.ceil(target) : Math.round(target * 10) / 10;
    return { name, metric, target: roundedTarget, startsAtMs, endsAtMs };
}

function challengeProgress(challenge, entries, members) {
    const progressByUser = {};
    (Array.isArray(members) ? members : []).forEach(member => {
        progressByUser[member.userId] = { userId: member.userId, nickname: member.nickname, value: 0, completedAtMs: null };
    });
    sortEntriesByTime(entries).forEach(({ entry, time }) => {
        if (time < challenge.startsAtMs || time > challenge.endsAtMs) return;
        const owner = getEntryValue(entry, "owner", false);
        const progress = progressByUser[owner];
        if (!progress) return;
        progress.value += entryMetricValue(entry, challenge.metric);
        if (progress.completedAtMs === null && progress.value >= challenge.target) progress.completedAtMs = time;
    });
    return Object.values(progressByUser)
        .map(item => ({
            userId: item.userId,
            nickname: item.nickname,
            value: Math.round(item.value * 10) / 10,
            percent: Math.min(100, Math.round(item.value / challenge.target * 100)),
            completed: item.completedAtMs !== null,
            completedAtMs: item.completedAtMs
        }))
        .sort((a, b) => (b.value - a.value) || String(a.nickname).localeCompare(String(b.nickname)));
}

function challengeStatus(challenge, nowMs = Date.now()) {
    if (nowMs < challenge.startsAtMs) return "upcoming";
    if (nowMs > challenge.endsAtMs) return "finished";
    return "active";
}

function challengeMedals(challenges, entries, members, nowMs = Date.now()) {
    return (Array.isArray(challenges) ? challenges : [])
        .filter(challenge => challengeStatus(challenge, nowMs) === "finished")
        .map(challenge => ({
            id: challenge.id,
            name: challenge.name,
            metric: challenge.metric,
            target: challenge.target,
            endsAtMs: challenge.endsAtMs,
            recipients: challengeProgress(challenge, entries, members)
                .filter(item => item.completed)
                .map(item => ({
                    userId: item.userId,
                    nickname: item.nickname,
                    completedAtMs: item.completedAtMs
                }))
                .sort((a, b) => (a.completedAtMs - b.completedAtMs) || a.nickname.localeCompare(b.nickname))
        }))
        .filter(challenge => challenge.recipients.length > 0)
        .sort((a, b) => b.endsAtMs - a.endsAtMs);
}

// Títulos de temporada calculados a partir de las marcas compartidas.
const SEASON_TITLES = [
    { key: "champion", icon: "\u{1F3C6}", name: "Campeón de temporada", description: "Más puntos de liga" },
    { key: "kingOfTheMountain", icon: "\u{1F451}", name: "King of the Mountain", description: "Más desnivel acumulado" },
    { key: "fastestRider", icon: "\u26A1", name: "Fastest Rider", description: "Velocidad punta más alta" },
    { key: "climbingBeast", icon: "\u26F0\uFE0F", name: "Climbing Beast", description: "Mayor desnivel en una salida" },
    { key: "mostConsistent", icon: "\u{1F525}", name: "Most Consistent", description: "Más salidas compartidas" }
];

function seasonTitles(entries, season, nicknames = {}) {
    const summary = groupRankingSummaryFromEntries(entries, { season });
    const riders = Object.keys(summary).map(userId => ({ userId, nickname: nicknames[userId] || "Ciclista", ...summary[userId] }));
    const pick = (score, tieBreak, format) => {
        const ranked = riders
            .map(rider => ({ rider, score: score(rider), tie: tieBreak(rider) }))
            .filter(item => Number.isFinite(item.score) && item.score > 0)
            .sort((a, b) => (b.score - a.score) || (b.tie - a.tie) || String(a.rider.nickname).localeCompare(String(b.rider.nickname)));
        if (!ranked.length) return null;
        const winner = ranked[0];
        return { userId: winner.rider.userId, nickname: winner.rider.nickname, value: format(winner.score) };
    };
    const scorers = {
        champion: () => pick(r => r.leaguePoints, r => r.totalDistanceKm, v => `${Math.round(v)} pts`),
        kingOfTheMountain: () => pick(r => r.totalElevationM, r => r.leaguePoints, v => `+${Math.round(v)} m`),
        fastestRider: () => pick(r => r.maxSpeedKmh, r => r.leaguePoints, v => `${v.toFixed(1)} km/h`),
        climbingBeast: () => pick(r => r.maxElevationGainM, r => r.totalElevationM, v => `+${Math.round(v)} m`),
        mostConsistent: () => pick(r => r.activityCount, r => r.totalDistanceKm, v => `${v} ${v === 1 ? "salida" : "salidas"}`)
    };
    return SEASON_TITLES.map(title => ({ ...title, winner: scorers[title.key]() }));
}

function groupActivityFeed(entries, challenges, nicknames = {}, options = {}) {
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 40));
    const sinceMs = Number(options.sinceMs) || 0;
    const items = [];
    const best = { distance: 0, elevation: 0, speed: 0 };
    sortEntriesByTime(entries).forEach(({ entry, time }) => {
        const owner = getEntryValue(entry, "owner", false);
        const distanceKm = getEntryValue(entry, "distanceKm", true);
        const elevationGain = getEntryValue(entry, "elevationGain", true);
        const maxSpeedKmh = getEntryValue(entry, "maxSpeedKmh", true);
        const movingTimeSec = getEntryValue(entry, "movingTimeSec", true);
        const records = [];
        if (distanceKm > best.distance && best.distance > 0) records.push("distance");
        if (elevationGain > best.elevation && best.elevation > 0) records.push("elevation");
        if (maxSpeedKmh > best.speed && best.speed > 0) records.push("speed");
        best.distance = Math.max(best.distance, distanceKm);
        best.elevation = Math.max(best.elevation, elevationGain);
        best.speed = Math.max(best.speed, maxSpeedKmh);
        if (time < sinceMs) return;
        items.push({
            type: "activity",
            timeMs: time,
            userId: owner,
            nickname: nicknames[owner] || "Ciclista",
            distanceKm: Math.round(distanceKm * 10) / 10,
            elevationGain: Math.round(elevationGain),
            movingTimeSec: Math.round(movingTimeSec),
            maxSpeedKmh: Math.round(maxSpeedKmh * 10) / 10,
            points: calculateActivityPoints(distanceKm, movingTimeSec, elevationGain),
            groupRecords: records
        });
    });
    (Array.isArray(challenges) ? challenges : []).forEach(challenge => {
        if (challenge.createdAtMs && challenge.createdAtMs >= sinceMs) {
            items.push({ type: "challenge-created", timeMs: challenge.createdAtMs, userId: challenge.createdBy, nickname: nicknames[challenge.createdBy] || "Ciclista", challengeId: challenge.id, challengeName: challenge.name });
        }
        (challenge.progress || []).forEach(progress => {
            if (progress.completed && progress.completedAtMs >= sinceMs) {
                items.push({ type: "challenge-completed", timeMs: progress.completedAtMs, userId: progress.userId, nickname: progress.nickname, challengeId: challenge.id, challengeName: challenge.name });
            }
        });
    });
    return items.sort((a, b) => b.timeMs - a.timeMs).slice(0, limit);
}

function recordTimeMs(record, field) {
    const raw = String(getEntryValue(record, field, false) || "").replace(" ", "T");
    const time = Date.parse(raw);
    return Number.isFinite(time) ? time : NaN;
}

// Contexto del grupo activo del usuario autenticado. Lanza un error con .status si no es válido.
function loadActiveGroupContext(authId, app = $app) {
    const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
    const user = app.findRecordById("users", authId);
    const groupId = user.getString("groupCode");
    if (!groupId) fail(404, "No hay un grupo activo.");
    const safeGroupId = requireSafeValue(groupId, "groupId");
    if (!safeMembership(safeGroupId, user.id, app).length) fail(403, "Ya no tienes autorización para consultar este grupo.");
    const group = app.findRecordById("mtb_groups", safeGroupId);
    const memberships = findAllRecordsByFilter("mtb_group_members", 'group = "' + safeGroupId + '"', "", app);
    const profiles = new Map(findRecordsByIds(app, "users", memberships.map(membership => membership.getString("user")))
        .map(profile => [profile.id, profile]));
    const nicknames = {};
    const members = memberships.map((membership) => {
        const userId = membership.getString("user");
        let nickname = membership.getString("nickname") || "";
        const profile = profiles.get(userId);
        if (profile) nickname = profile.getString("nickname").trim() || nickname;
        nicknames[userId] = nickname || "Apodo pendiente";
        return { userId, nickname: nicknames[userId] };
    });
    return { user, groupId: safeGroupId, group, members, nicknames, isAdmin: group.getString("owner") === user.id };
}

function challengeFromRecord(record) {
    return {
        id: record.id,
        name: record.getString("name"),
        metric: record.getString("metric"),
        target: record.getFloat("target"),
        startsAtMs: recordTimeMs(record, "startsAt"),
        endsAtMs: recordTimeMs(record, "endsAt"),
        createdBy: record.getString("createdBy"),
        createdAtMs: recordTimeMs(record, "created")
    };
}

// Para cada segmento, el miembro con el mejor tiempo del grupo suma un liderato.
function segmentLeadsByUser(efforts) {
    const bestBySegment = {};
    (Array.isArray(efforts) ? efforts : []).forEach(effort => {
        const segment = getEntryValue(effort, "segment", false);
        const owner = getEntryValue(effort, "owner", false);
        const seconds = getEntryValue(effort, "elapsedSeconds", true);
        if (!segment || !owner || !(seconds > 0)) return;
        const current = bestBySegment[segment];
        if (!current || seconds < current.seconds) bestBySegment[segment] = { owner, seconds };
    });
    const leads = {};
    Object.values(bestBySegment).forEach(best => { leads[best.owner] = (leads[best.owner] || 0) + 1; });
    return leads;
}

module.exports = {
    SAFE_ID_RE,
    SAFE_INVITE_RE,
    SEASON_DURATION_DAYS,
    SEASON_DURATION_MS,
    LEAGUE_EPOCH_MS,
    requireSafeValue,
    requireNickname,
    safeMembership,
    findRecordsByIds,
    findAllRecordsByFilter,
    deleteAllRecordsByFilter,
    getSeasonInfo,
    calculateActivityPoints,
    groupRankingSummaryFromEntries,
    entryTimeMs,
    CHALLENGE_METRICS,
    CHALLENGE_MAX_ACTIVE,
    getSeasonInfoByNumber,
    validateChallengeInput,
    challengeProgress,
    challengeStatus,
    challengeMedals,
    SEASON_TITLES,
    seasonTitles,
    groupActivityFeed,
    segmentLeadsByUser,
    recordTimeMs,
    loadActiveGroupContext,
    challengeFromRecord
};
