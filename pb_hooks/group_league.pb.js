// Liga de grupo: desafíos, títulos de temporada y actividad.
// Todas las rutas exigen sesión y pertenecer al grupo activo (users.groupCode).

routerAdd("GET", "/api/mtb/groups/challenges", (e) => {
    const utils = require(`${__hooks}/groups_utils.js`);
    try {
        const ctx = utils.loadActiveGroupContext(e.auth.id);
        const now = Date.now();
        const entries = utils.findAllRecordsByFilter("mtb_group_ranking_entries", "group = {:group}", "", $app, { group: ctx.groupId });
        const records = utils.findAllRecordsByFilter("mtb_group_challenges", "group = {:group}", "-endsAt", $app, { group: ctx.groupId });
        const challenges = records.map((record) => utils.challengeFromRecord(record))
            .filter(challenge => utils.challengeStatus(challenge, now) !== "finished")
            .map((challenge) => {
                const progress = utils.challengeProgress(challenge, entries, ctx.members);
                const mine = progress.find(item => item.userId === ctx.user.id) || null;
                return {
                    id: challenge.id,
                    name: challenge.name,
                    metric: challenge.metric,
                    target: challenge.target,
                    startsAt: new Date(challenge.startsAtMs).toISOString(),
                    endsAt: new Date(challenge.endsAtMs).toISOString(),
                    status: utils.challengeStatus(challenge, now),
                    createdBy: ctx.nicknames[challenge.createdBy] || "Ciclista",
                    canDelete: ctx.isAdmin || challenge.createdBy === ctx.user.id,
                    completedCount: progress.filter(item => item.completed).length,
                    mine,
                    progress
                };
            });
        const order = { active: 0, upcoming: 1, finished: 2 };
        challenges.sort((a, b) => (order[a.status] - order[b.status]) || (Date.parse(a.endsAt) - Date.parse(b.endsAt)));
        const season = utils.getSeasonInfo(now);
        const summary = utils.groupRankingSummaryFromEntries(entries, { season });
        const standings = ctx.members
            .map(member => ({ userId: member.userId, nickname: member.nickname, isMe: member.userId === ctx.user.id, leaguePoints: (summary[member.userId] || {}).leaguePoints || 0, activityCount: (summary[member.userId] || {}).activityCount || 0 }))
            .sort((a, b) => b.leaguePoints - a.leaguePoints || a.nickname.localeCompare(b.nickname));
        return e.json(200, {
            group: { id: ctx.groupId, name: ctx.group.getString("name") },
            season,
            standings,
            isAdmin: ctx.isAdmin,
            metrics: utils.CHALLENGE_METRICS,
            challenges
        });
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudieron cargar los desafíos." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/challenges", (e) => {
    const utils = require(`${__hooks}/groups_utils.js`);
    try {
        const body = new DynamicModel({ name: "", metric: "", target: 0.1, startsAt: "", endsAt: "" });
        e.bindBody(body);
        const input = utils.validateChallengeInput({ name: body.name, metric: body.metric, target: body.target, startsAt: body.startsAt, endsAt: body.endsAt });
        let result;
        $app.runInTransaction((txApp) => {
            const ctx = utils.loadActiveGroupContext(e.auth.id, txApp);
            utils.requireVerifiedCommunityUser(ctx.user);
            const now = Date.now();
            const open = utils.findAllRecordsByFilter("mtb_group_challenges", "group = {:group}", "", txApp, { group: ctx.groupId })
                .map(utils.challengeFromRecord)
                .filter(challenge => utils.challengeStatus(challenge, now) !== "finished");
            if (open.length >= utils.CHALLENGE_MAX_ACTIVE) {
                result = {
                    status: 400,
                    body: { message: `El grupo ya tiene ${utils.CHALLENGE_MAX_ACTIVE} desafíos abiertos. Elimina alguno antes de crear otro.` }
                };
                return;
            }
            const record = new Record(txApp.findCollectionByNameOrId("mtb_group_challenges"));
            record.set("group", ctx.groupId);
            record.set("createdBy", ctx.user.id);
            record.set("name", input.name);
            record.set("metric", input.metric);
            record.set("target", input.target);
            record.set("startsAt", new Date(input.startsAtMs).toISOString());
            record.set("endsAt", new Date(input.endsAtMs).toISOString());
            txApp.save(record);
            result = { status: 200, body: { ok: true, id: record.id } };
        });
        return e.json(result.status, result.body);
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo crear el desafío." });
    }
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/groups/challenges/delete", (e) => {
    const utils = require(`${__hooks}/groups_utils.js`);
    try {
        const ctx = utils.loadActiveGroupContext(e.auth.id);
        utils.requireVerifiedCommunityUser(ctx.user);
        const body = new DynamicModel({ id: "" });
        e.bindBody(body);
        const id = utils.requireSafeValue(body.id, "id");
        const record = $app.findRecordById("mtb_group_challenges", id);
        if (record.getString("group") !== ctx.groupId) return e.json(404, { message: "El desafío no existe en este grupo." });
        if (!ctx.isAdmin && record.getString("createdBy") !== ctx.user.id) {
            return e.json(403, { message: "Solo quien creó el desafío o el administrador pueden eliminarlo." });
        }
        $app.delete(record);
        return e.json(200, { ok: true });
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo eliminar el desafío." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/awards", (e) => {
    const utils = require(`${__hooks}/groups_utils.js`);
    try {
        const ctx = utils.loadActiveGroupContext(e.auth.id);
        const now = Date.now();
        const entries = utils.findAllRecordsByFilter("mtb_group_ranking_entries", "group = {:group}", "", $app, { group: ctx.groupId });
        const current = utils.getSeasonInfo(now);
        const challengeRecords = utils.findAllRecordsByFilter("mtb_group_challenges", "group = {:group}", "", $app, { group: ctx.groupId });
        const historicalMembers = new Map(ctx.members.map(member => [member.userId, member]));
        const historicalProfiles = utils.findRecordsByIds($app, "users", entries.map(entry => entry.getString("owner")).filter(Boolean));
        historicalProfiles.forEach(profile => {
            const nickname = profile.getString("nickname").trim()
                || (historicalMembers.get(profile.id) || {}).nickname
                || "Ciclista";
            historicalMembers.set(profile.id, { userId: profile.id, nickname });
        });
        const challengeMedals = utils.challengeMedals(
            challengeRecords.map(utils.challengeFromRecord),
            entries,
            Array.from(historicalMembers.values()),
            now
        );
        const history = [];
        for (let number = current.seasonNumber - 1; number >= 1 && history.length < 12; number--) {
            const season = utils.getSeasonInfoByNumber(number, now);
            const titles = utils.seasonTitles(entries, season, ctx.nicknames);
            if (titles.some(title => title.winner)) history.push({ season, titles });
        }
        const medals = {};
        history.forEach(item => item.titles.forEach(title => {
            if (!title.winner) return;
            const medal = medals[title.winner.userId] || { userId: title.winner.userId, nickname: title.winner.nickname, count: 0 };
            medal.count++;
            medals[title.winner.userId] = medal;
        }));
        return e.json(200, {
            group: { id: ctx.groupId, name: ctx.group.getString("name") },
            current: { season: current, titles: utils.seasonTitles(entries, current, ctx.nicknames) },
            history,
            medalTable: Object.values(medals).sort((a, b) => b.count - a.count || a.nickname.localeCompare(b.nickname)),
            challengeMedals
        });
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudieron cargar los títulos." });
    }
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/groups/activity", (e) => {
    const utils = require(`${__hooks}/groups_utils.js`);
    try {
        const ctx = utils.loadActiveGroupContext(e.auth.id);
        const now = Date.now();
        const entries = utils.findAllRecordsByFilter("mtb_group_ranking_entries", "group = {:group}", "", $app, { group: ctx.groupId });
        const challenges = utils.findAllRecordsByFilter("mtb_group_challenges", "group = {:group}", "", $app, { group: ctx.groupId })
            .map((record) => {
                const challenge = utils.challengeFromRecord(record);
                challenge.progress = utils.challengeProgress(challenge, entries, ctx.members);
                return challenge;
            });
        const items = utils.groupActivityFeed(entries, challenges, ctx.nicknames, { sinceMs: now - 90 * 24 * 60 * 60 * 1000, limit: 40 })
            .map(item => ({ ...item, isMe: item.userId === ctx.user.id, time: new Date(item.timeMs).toISOString() }));
        return e.json(200, { group: { id: ctx.groupId, name: ctx.group.getString("name") }, items });
    } catch (err) {
        return e.json(err.status || 400, { message: err.clientMessage || "No se pudo cargar la actividad del grupo." });
    }
}, $apis.requireAuth("users"));
