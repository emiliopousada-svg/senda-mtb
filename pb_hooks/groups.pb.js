// Grupos globales para MTBPro. Los helpers viven en groups_utils.js (cada handler se ejecuta aislado).

routerAdd("POST", "/api/mtb/groups/create", (e) => {
    const { requireSafeValue, requireNickname, requireVerifiedCommunityUser } = require(`${__hooks}/groups_utils.js`);
    const { enforceCommunityWriteQuota } = require(`${__hooks}/community_quota_utils.js`);
    try {
        const body = new DynamicModel({ name: "" });
        e.bindBody(body);
        const name = String(body.name || "").trim().slice(0, 40);
        if (!name) return e.json(400, { message: "Escribe un nombre para el grupo." });
        // Sin icono la app envía JSON; findUploadedFiles falla si la petición no es multipart.
        let iconFiles = [];
        try { iconFiles = e.findUploadedFiles("icon") || []; } catch (_) { iconFiles = []; }

        let response;
        $app.runInTransaction((txApp) => {
            const user = txApp.findRecordById("users", e.auth.id);
            requireVerifiedCommunityUser(user);
            const nickname = requireNickname(user.getString("nickname"));
            enforceCommunityWriteQuota(txApp, user.id, "group");
            const group = new Record(txApp.findCollectionByNameOrId("mtb_groups"));
            group.set("name", name);
            if (iconFiles.length) group.set("icon", iconFiles);
            group.set("owner", user.id);
            group.set("inviteCode", $security.randomString(12).toUpperCase());
            txApp.save(group);

            const membership = new Record(txApp.findCollectionByNameOrId("mtb_group_members"));
            membership.set("group", requireSafeValue(group.id, "groupId"));
            membership.set("user", requireSafeValue(user.id, "userId"));
            membership.set("nickname", nickname);
            txApp.save(membership);
            user.set("groupCode", group.id);
            txApp.save(user);
            response = {
                group: {
                    id: group.id,
                    name: group.getString("name"),
                    icon: group.getString("icon"),
                    isAdmin: true,
                    inviteCode: group.getString("inviteCode")
                }
            };
        });

        return e.json(200, response);
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo crear el grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/join", (e) => {
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, requireVerifiedCommunityUser, safeMembership } = require(`${__hooks}/groups_utils.js`);
    try {
        const body = new DynamicModel({ code: "" });
        e.bindBody(body);
        const code = String(body.code || "").trim().toUpperCase();
        if (!SAFE_INVITE_RE.test(code)) return e.json(400, { message: "El código de invitación no es válido." });
        let response;
        $app.runInTransaction((txApp) => {
            const user = txApp.findRecordById("users", e.auth.id);
            requireVerifiedCommunityUser(user);
            const nickname = requireNickname(user.getString("nickname"));
            const group = txApp.findFirstRecordByFilter("mtb_groups", "inviteCode = {:code}", { code });
            const memberships = safeMembership(group.id, user.id, txApp);
            const membership = memberships[0] || new Record(txApp.findCollectionByNameOrId("mtb_group_members"));
            membership.set("group", requireSafeValue(group.id, "groupId"));
            membership.set("user", requireSafeValue(user.id, "userId"));
            membership.set("nickname", nickname);
            txApp.save(membership);
            user.set("groupCode", group.id);
            txApp.save(user);
            const isAdmin = group.getString("owner") === user.id;
            response = { id: group.id, name: group.getString("name"), icon: group.getString("icon"), isAdmin };
            if (isAdmin) response.inviteCode = group.getString("inviteCode");
        });
        return e.json(200, { group: response });
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo encontrar el grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/select", (e) => {
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, requireVerifiedCommunityUser, safeMembership } = require(`${__hooks}/groups_utils.js`);
    try {
        const body = new DynamicModel({ groupId: "" });
        e.bindBody(body);
        const groupId = requireSafeValue(body.groupId, "groupId");
        let result;
        $app.runInTransaction((txApp) => {
            const user = txApp.findRecordById("users", e.auth.id);
            requireVerifiedCommunityUser(user);
            const nickname = requireNickname(user.getString("nickname"));
            const memberships = safeMembership(groupId, user.id, txApp);
            if (!memberships.length) {
                result = { status: 403, body: { message: "Ya no tienes autorización para entrar en este grupo." } };
                return;
            }
            memberships[0].set("nickname", nickname);
            txApp.save(memberships[0]);
            const group = txApp.findRecordById("mtb_groups", groupId);
            user.set("groupCode", groupId);
            txApp.save(user);
            const isAdmin = group.getString("owner") === user.id;
            const response = { id: group.id, name: group.getString("name"), icon: group.getString("icon"), isAdmin };
            if (isAdmin) response.inviteCode = group.getString("inviteCode");
            result = { status: 200, body: { group: response } };
        });
        return e.json(result.status, result.body);
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo activar el grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/my", (e) => {
    const { requireSafeValue, findRecordsByIds, findAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const safeUserId = requireSafeValue(user.id, "userId");
        const memberships = findAllRecordsByFilter("mtb_group_members", "user = {:user}", "", $app, { user: safeUserId });
        const groupById = new Map(findRecordsByIds($app, "mtb_groups", memberships.map(membership => membership.getString("group")))
            .map(group => [group.id, group]));
        const groups = [];
        for (const membership of memberships) {
            const group = groupById.get(membership.getString("group"));
            if (!group) continue;
            const isAdmin = group.getString("owner") === user.id;
            const item = { id: group.id, name: group.getString("name"), icon: group.getString("icon"), isAdmin, nickname: user.getString("nickname").trim() || membership.getString("nickname") };
            if (isAdmin) item.inviteCode = group.getString("inviteCode");
            groups.push(item);
        }
        return e.json(200, { groups, activeGroupId: user.getString("groupCode") });
    } catch (err) {
        return e.json(401, { message: err.clientMessage || "Inicia sesión." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/members", (e) => {
    const { requireSafeValue, findRecordsByIds, findAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const group = $app.findRecordById("mtb_groups", safeGroupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede ver y gestionar los miembros." });
        const memberships = findAllRecordsByFilter("mtb_group_members", "group = {:group}", "", $app, { group: safeGroupId });
        const memberById = new Map(findRecordsByIds($app, "users", memberships.map(membership => membership.getString("user")))
            .map(member => [member.id, member]));
        const members = memberships.map((membership) => {
            const userId = membership.getString("user");
            const member = memberById.get(userId);
            return {
                userId,
                nickname: (member ? member.getString("nickname").trim() : "") || membership.getString("nickname") || "Apodo pendiente",
                isAdmin: userId === user.id
            };
        });
        return e.json(200, { members });
    } catch (err) {
        return e.json(400, { message: err.clientMessage || "No se pudieron cargar los miembros." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/transfer", (e) => {
    const { requireSafeValue, requireVerifiedCommunityUser, clientError } = require(`${__hooks}/groups_utils.js`);
    try {
        const body = new DynamicModel({ userId: "" });
        e.bindBody(body);
        const user = $app.findRecordById("users", e.auth.id);
        requireVerifiedCommunityUser(user);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const currentGroup = $app.findRecordById("mtb_groups", safeGroupId);
        if (currentGroup.getString("owner") !== user.id) {
            return e.json(403, { message: "Solo el administrador actual puede transferir la administración." });
        }
        const targetId = requireSafeValue(body.userId, "userId");
        if (targetId === user.id) return e.json(400, { message: "Ya eres el administrador del grupo." });

        $app.runInTransaction((txApp) => {
            const group = txApp.findRecordById("mtb_groups", safeGroupId);
            if (group.getString("owner") !== user.id) {
                throw clientError("Solo el administrador actual puede transferir la administración.");
            }
            try {
                txApp.findFirstRecordByFilter(
                    "mtb_group_members",
                    "group = {:group} && user = {:user}",
                    { group: safeGroupId, user: targetId }
                );
            } catch (error) {
                throw clientError("La nueva persona administradora debe pertenecer al grupo.");
            }
            const target = txApp.findRecordById("users", targetId);
            group.set("owner", target.id);
            target.set("groupCode", safeGroupId);
            txApp.save(group);
            txApp.save(target);
        });

        return e.json(200, { ok: true, groupId: safeGroupId, ownerId: targetId });
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo transferir la administración." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/live", (e) => {
    const { requireSafeValue, safeMembership, findRecordsByIds, findAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        if (!safeMembership(safeGroupId, user.id).length) {
            return e.json(403, { message: "Ya no tienes autorización para consultar este grupo." });
        }
        const locations = findAllRecordsByFilter("live_locations", "groupCode = {:group}", "-updated", $app, { group: safeGroupId });
        const profileById = new Map(findRecordsByIds($app, "users", locations.map(location => location.getString("owner")))
            .map(profile => [profile.id, profile]));
        const items = locations.map((location) => {
            const owner = location.getString("owner");
            const profile = profileById.get(owner);
            const item = {
                id: location.id,
                owner,
                groupCode: location.getString("groupCode"),
                name: location.getString("name"),
                nickname: "",
                lat: location.getFloat("lat"),
                lon: location.getFloat("lon"),
                accuracy: location.getFloat("accuracy"),
                updated: location.getString("updated")
            };
            if (profile) {
                item.nickname = profile.getString("nickname").trim();
                if (item.nickname) item.name = item.nickname;
                item.avatar = profile.getString("avatar");
            }
            return item;
        });
        return e.json(200, { items });
    } catch (err) {
        return e.json(400, { message: err.clientMessage || "No se pudieron cargar las posiciones del grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/rankings", (e) => {
    const { requireSafeValue, safeMembership, findRecordsByIds, findAllRecordsByFilter, groupRankingSummaryFromEntries, getSeasonInfo, segmentLeadsByUser } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        if (!safeMembership(safeGroupId, user.id).length) {
            return e.json(403, { message: "Ya no tienes autorización para consultar este grupo." });
        }

        const season = getSeasonInfo(Date.now());
        const memberships = findAllRecordsByFilter("mtb_group_members", "group = {:group}", "", $app, { group: safeGroupId });
        const entries = findAllRecordsByFilter("mtb_group_ranking_entries", "group = {:group}", "", $app, { group: safeGroupId });
        const rankingsByUser = groupRankingSummaryFromEntries(entries, { season });
        // Lideratos de segmentos: mejor tiempo del grupo en cada segmento comunitario.
        const memberIds = memberships.map(membership => requireSafeValue(membership.getString("user"), "userId"));
        const segmentEfforts = [];
        for (let index = 0; index < memberIds.length; index += 25) {
            const ownerParams = {};
            const ownerFilter = memberIds.slice(index, index + 25).map((id, offset) => {
                const key = `owner${offset}`;
                ownerParams[key] = id;
                return `owner = {:${key}}`;
            }).join(" || ");
            if (ownerFilter) segmentEfforts.push(...findAllRecordsByFilter("community_segment_efforts", ownerFilter, "", $app, ownerParams));
        }
        const segmentLeads = segmentLeadsByUser(segmentEfforts);
        const memberById = new Map(findRecordsByIds($app, "users", memberIds).map(member => [member.id, member]));
        const members = memberships.map((membership) => {
            const userId = membership.getString("user");
            const member = memberById.get(userId);
            const ranking = rankingsByUser[userId] || {};
            return {
                userId,
                nickname: (member ? member.getString("nickname").trim() : "") || membership.getString("nickname") || "Apodo pendiente",
                isMe: userId === user.id,
                maxDistanceKm: ranking.maxDistanceKm ?? null,
                distanceMovingTimeSec: ranking.distanceMovingTimeSec ?? null,
                maxElevationGainM: ranking.maxElevationGainM ?? null,
                bestMovingTimeSec: ranking.bestMovingTimeSec ?? null,
                maxSpeedKmh: ranking.maxSpeedKmh ?? null,
                activityCount: ranking.activityCount ?? 0,
                leaguePoints: ranking.leaguePoints ?? 0,
                segmentLeads: segmentLeads[userId] || 0
            };
        });
        return e.json(200, {
            group: { id: safeGroupId, name: $app.findRecordById("mtb_groups", safeGroupId).getString("name") },
            season,
            members
        });
    } catch (err) {
        return e.json(400, { message: err.clientMessage || "No se pudo cargar el ranking del grupo." });
    }
}, $apis.requireAuth("users"));

function readSynchronizedRouteTrack(route, clientError) {
    const filename = route.getString("track");
    if (!filename) throw clientError("La ruta sincronizada no tiene un trazado disponible.");

    const filesystem = $app.newFilesystem();
    let reader = null;
    try {
        reader = filesystem.getReader($filepath.join(route.baseFilesPath(), filename));
        if (reader.size() > 26214400) throw clientError("El trazado sincronizado supera el límite permitido.");

        const parts = [];
        const buffer = Array(16384).fill(0);
        while (true) {
            const count = reader.read(buffer);
            if (!count) break;
            parts.push(String.fromCharCode.apply(null, buffer.slice(0, count)));
        }
        return JSON.parse(parts.join(""));
    } finally {
        try {
            if (reader) reader.close();
        } finally {
            filesystem.close();
        }
    }
}

routerAdd("POST", "/api/mtb/groups/rankings/share", (e) => {
    const {
        requireSafeValue,
        safeMembership,
        findAllRecordsByFilter,
        groupRankingSummaryFromEntries,
        calculateGroupActivityMetrics,
        requireVerifiedCommunityUser,
        clientError
    } = require(`${__hooks}/groups_utils.js`);
    try {
        // Older app versions still send these fields; the server deliberately ignores their values.
        const body = new DynamicModel({
            clientId: 0,
            groupId: "",
            distanceKm: 0.1,
            movingTimeSec: 0.1,
            maxSpeedKmh: 0.1,
            elevationGain: 0.1
        });
        e.bindBody(body);
        const clientId = Number(body.clientId);
        if (!Number.isFinite(clientId) || clientId <= 0 || Math.floor(clientId) !== clientId || clientId > 9007199254740991) {
            return e.json(400, { message: "Las marcas de la actividad no son válidas." });
        }

        const user = $app.findRecordById("users", e.auth.id);
        requireVerifiedCommunityUser(user);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        if (!safeMembership(safeGroupId, user.id).length) {
            return e.json(403, { message: "Ya no tienes autorización para compartir marcas en este grupo." });
        }

        const routes = $app.findRecordsByFilter(
            "routes",
            "owner = {:owner} && clientId = {:clientId}",
            "",
            1,
            0,
            { owner: user.id, clientId }
        );
        const route = routes[0];
        if (!route) return e.json(404, { message: "Sincroniza primero esta actividad para poder verificar sus marcas." });
        if (route.getString("kind") !== "recorded") {
            return e.json(400, { message: "Solo se pueden compartir actividades grabadas." });
        }

        const routeSyncedAt = route.getString("created");
        if (!Number.isFinite(Date.parse(String(routeSyncedAt).replace(" ", "T")))) {
            return e.json(400, { message: "No se pudo verificar la fecha de sincronización de la actividad." });
        }
        const metrics = calculateGroupActivityMetrics(readSynchronizedRouteTrack(route, clientError));
        const { distanceKm, movingTimeSec, maxSpeedKmh, elevationGain } = metrics;

        const filter = "group = {:group} && owner = {:owner}";
        const filterParams = { group: safeGroupId, owner: user.id };
        const existingEntries = findAllRecordsByFilter("mtb_group_ranking_entries", filter, "", $app, filterParams);
        const previousRanking = groupRankingSummaryFromEntries(existingEntries)[user.id] || {
            maxDistanceKm: 0,
            maxElevationGainM: 0,
            bestMovingTimeSec: 0,
            maxSpeedKmh: 0,
            activityCount: 0,
            leaguePoints: 0
        };
        const existing = $app.findRecordsByFilter(
            "mtb_group_ranking_entries",
            "group = {:group} && owner = {:owner} && clientId = {:clientId}",
            "",
            1,
            0,
            { group: safeGroupId, owner: user.id, clientId }
        );
        const entry = existing.length ? existing[0] : new Record($app.findCollectionByNameOrId("mtb_group_ranking_entries"));
        entry.set("group", safeGroupId);
        entry.set("owner", user.id);
        entry.set("routeSyncedAt", routeSyncedAt);
        entry.set("clientId", clientId);
        entry.set("route", route.id);
        entry.set("distanceKm", distanceKm);
        entry.set("movingTimeSec", movingTimeSec);
        entry.set("maxSpeedKmh", maxSpeedKmh);
        entry.set("elevationGain", elevationGain);
        $app.save(entry);

        const entriesAfter = existingEntries.filter(item => item.getFloat("clientId") !== clientId);
        entriesAfter.push(entry);
        const ranking = groupRankingSummaryFromEntries(entriesAfter)[user.id];
        return e.json(200, {
            maxDistanceKm: ranking.maxDistanceKm,
            distanceMovingTimeSec: ranking.distanceMovingTimeSec,
            maxElevationGainM: ranking.maxElevationGainM,
            bestMovingTimeSec: ranking.bestMovingTimeSec,
            maxSpeedKmh: ranking.maxSpeedKmh,
            activityCount: ranking.activityCount,
            leaguePoints: ranking.leaguePoints,
            newDistanceRecord: distanceKm > previousRanking.maxDistanceKm,
            newAscentRecord: elevationGain > (previousRanking.maxElevationGainM || 0),
            newTimeRecord: movingTimeSec > previousRanking.bestMovingTimeSec,
            newSpeedRecord: maxSpeedKmh > previousRanking.maxSpeedKmh
        });
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudieron compartir las marcas de la actividad." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/rankings/delete", (e) => {
    const { requireSafeValue, requireVerifiedCommunityUser, deleteAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        requireVerifiedCommunityUser(user);
        const body = new DynamicModel({ clientId: 0 });
        e.bindBody(body);
        const clientId = Number(body.clientId);
        if (!Number.isFinite(clientId) || clientId <= 0 || Math.floor(clientId) !== clientId || clientId > 9007199254740991) {
            return e.json(400, { message: "El identificador de la actividad no es válido." });
        }
        const userId = requireSafeValue(e.auth.id, "owner");
        let deleted;
        $app.runInTransaction((txApp) => {
            deleted = deleteAllRecordsByFilter(
                "mtb_group_ranking_entries",
                "owner = {:owner} && clientId = {:clientId}",
                txApp,
                { owner: userId, clientId }
            );
        });
        return e.json(200, { deleted });
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo retirar la marca de la actividad." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/rotate-invite", (e) => {
    const { SAFE_INVITE_RE, requireSafeValue, requireNickname, requireVerifiedCommunityUser, safeMembership } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        requireVerifiedCommunityUser(user);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const group = $app.findRecordById("mtb_groups", safeGroupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede renovar la invitación." });
        group.set("inviteCode", $security.randomString(12).toUpperCase());
        $app.save(group);
        return e.json(200, { group: { id: group.id, name: group.getString("name"), icon: group.getString("icon"), isAdmin: true, inviteCode: group.getString("inviteCode") } });
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo renovar la invitación." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/icon", (e) => {
    const { requireSafeValue, requireVerifiedCommunityUser } = require(`${__hooks}/groups_utils.js`);
    try {
        const user = $app.findRecordById("users", e.auth.id);
        requireVerifiedCommunityUser(user);
        const groupId = user.getString("groupCode");
        if (!groupId) return e.json(404, { message: "No hay un grupo activo." });
        const safeGroupId = requireSafeValue(groupId, "groupId");
        const group = $app.findRecordById("mtb_groups", safeGroupId);
        if (group.getString("owner") !== user.id) return e.json(403, { message: "Solo el administrador puede cambiar el logo del grupo." });
        let iconFiles = [];
        try { iconFiles = e.findUploadedFiles("icon") || []; } catch (_) { iconFiles = []; }
        if (!iconFiles.length) return e.json(400, { message: "Selecciona un logo para el grupo." });
        group.set("icon", iconFiles);
        $app.save(group);
        return e.json(200, {
            group: { id: group.id, name: group.getString("name"), icon: group.getString("icon"), isAdmin: true }
        });
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo actualizar el logo del grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/revoke", (e) => {
    const { requireSafeValue, requireVerifiedCommunityUser, safeMembership, deleteAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const body = new DynamicModel({ userId: "" });
        e.bindBody(body);
        const targetId = requireSafeValue(body.userId, "userId");
        let result;
        $app.runInTransaction((txApp) => {
            const user = txApp.findRecordById("users", e.auth.id);
            requireVerifiedCommunityUser(user);
            const groupId = user.getString("groupCode");
            if (!groupId) {
                result = { status: 404, body: { message: "No hay un grupo activo." } };
                return;
            }
            const safeGroupId = requireSafeValue(groupId, "groupId");
            const group = txApp.findRecordById("mtb_groups", safeGroupId);
            if (group.getString("owner") !== user.id) {
                result = { status: 403, body: { message: "Solo el administrador puede revocar miembros." } };
                return;
            }
            if (targetId === user.id) {
                result = { status: 400, body: { message: "El administrador no puede revocarse a sí mismo." } };
                return;
            }
            const memberships = safeMembership(safeGroupId, targetId, txApp);
            if (!memberships.length) {
                result = { status: 404, body: { message: "Ese miembro ya no pertenece al grupo." } };
                return;
            }
            const target = txApp.findRecordById("users", targetId);
            if (target.getString("groupCode") === safeGroupId) {
                target.set("groupCode", "");
                txApp.save(target);
            }
            deleteAllRecordsByFilter("live_locations", "owner = {:owner} && groupCode = {:group}", txApp, { owner: targetId, group: safeGroupId });
            txApp.delete(memberships[0]);
            const newInviteCode = $security.randomString(12).toUpperCase();
            group.set("inviteCode", newInviteCode);
            txApp.save(group);
            result = { status: 200, body: { ok: true, inviteCode: newInviteCode } };
        });
        return e.json(result.status, result.body);
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo revocar el acceso." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/leave", (e) => {
    const { requireSafeValue, requireVerifiedCommunityUser, deleteAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        const body = new DynamicModel({ groupId: "" });
        e.bindBody(body);
        let result;
        $app.runInTransaction((txApp) => {
            const user = txApp.findRecordById("users", e.auth.id);
            requireVerifiedCommunityUser(user);
            const groupId = user.getString("groupCode");
            if (!groupId) {
                result = { status: 200, body: { ok: true } };
                return;
            }
            const requestedGroupId = body.groupId
                ? requireSafeValue(body.groupId, "groupId")
                : groupId;
            if (requestedGroupId !== groupId) {
                result = { status: 200, body: { ok: true, retained: true } };
                return;
            }
            const safeGroupId = requireSafeValue(groupId, "groupId");
            const group = txApp.findRecordById("mtb_groups", safeGroupId);
            if (group.getString("owner") === user.id) {
                result = { status: 400, body: { message: "Transfiere la administración o elimina el grupo antes de salir." } };
                return;
            }
            deleteAllRecordsByFilter("live_locations", "owner = {:owner} && groupCode = {:group}", txApp, { owner: user.id, group: safeGroupId });
            user.set("groupCode", "");
            txApp.save(user);
            result = { status: 200, body: { ok: true, retained: true } };
        });
        return e.json(result.status, result.body);
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo salir del grupo." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/delete", (e) => {
    const { requireSafeValue, requireVerifiedCommunityUser, findRecordsByIds, deleteAllRecordsByFilter } = require(`${__hooks}/groups_utils.js`);
    try {
        let result;
        $app.runInTransaction((txApp) => {
            const user = txApp.findRecordById("users", e.auth.id);
            requireVerifiedCommunityUser(user);
            const groupId = user.getString("groupCode");
            if (!groupId) {
                result = { status: 404, body: { message: "No hay un grupo activo." } };
                return;
            }
            const safeGroupId = requireSafeValue(groupId, "groupId");
            const group = txApp.findRecordById("mtb_groups", safeGroupId);
            if (group.getString("owner") !== user.id) {
                result = { status: 403, body: { message: "Solo el administrador puede eliminar el grupo." } };
                return;
            }
            while (true) {
                const memberships = txApp.findRecordsByFilter("mtb_group_members", "group = {:group}", "", 200, 0, { group: safeGroupId });
                if (!memberships.length) break;
                const memberById = new Map(findRecordsByIds(txApp, "users", memberships.map(membership => membership.getString("user")))
                    .map(member => [member.id, member]));
                for (const membership of memberships) {
                    const member = memberById.get(membership.getString("user"));
                    if (member && member.getString("groupCode") === safeGroupId) {
                        member.set("groupCode", "");
                        txApp.save(member);
                    }
                    txApp.delete(membership);
                }
            }
            deleteAllRecordsByFilter("live_locations", "groupCode = {:group}", txApp, { group: safeGroupId });
            txApp.delete(group);
            result = { status: 200, body: { ok: true } };
        });
        return e.json(result.status, result.body);
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo eliminar el grupo." });
    }
}, $apis.requireAuth("users"));
