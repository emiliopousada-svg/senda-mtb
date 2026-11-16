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

function safeMembership(groupId, userId) {
    const safeGroupId = requireSafeValue(groupId, "groupId");
    const safeUserId = requireSafeValue(userId, "userId");
    return $app.findRecordsByFilter("mtb_group_members", "group = {:group} && user = {:user}", "", 1, 0, { group: safeGroupId, user: safeUserId });
}

function findAllRecordsByFilter(collection, filter, sort) {
    const records = [];
    const pageSize = 200;
    let offset = 0;
    while (true) {
        const page = $app.findRecordsByFilter(collection, filter, sort, pageSize, offset);
        records.push(...page);
        if (page.length < pageSize) return records;
        offset += page.length;
    }
}

function deleteAllRecordsByFilter(collection, filter) {
    const batchSize = 200;
    let deleted = 0;
    while (true) {
        const batch = $app.findRecordsByFilter(collection, filter, "", batchSize, 0);
        if (!batch.length) return deleted;
        for (const record of batch) {
            $app.delete(record);
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

function groupRankingSummaryFromEntries(entries, options = {}) {
    const season = options.season || null;
    const rankings = {};
    if (!Array.isArray(entries)) return rankings;

    entries.forEach((entry) => {
        if (season) {
            const created = getEntryValue(entry, "created", false);
            const entryTime = Date.parse(created);
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

module.exports = {
    SAFE_ID_RE,
    SAFE_INVITE_RE,
    SEASON_DURATION_DAYS,
    SEASON_DURATION_MS,
    LEAGUE_EPOCH_MS,
    requireSafeValue,
    requireNickname,
    safeMembership,
    findAllRecordsByFilter,
    deleteAllRecordsByFilter,
    getSeasonInfo,
    calculateActivityPoints,
    groupRankingSummaryFromEntries
};
