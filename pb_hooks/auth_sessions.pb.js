routerUse(new Middleware((e) => {
    const { APP_ORIGIN } = require(`${__hooks}/auth_sessions_utils.js`);
    if (e.request.header.get("Origin") === APP_ORIGIN) {
        e.response.header().set("Access-Control-Allow-Credentials", "true");
    }
    return e.next();
}, -1042));

routerUse(new Middleware((e) => {
    const {
        SESSION_COOKIE_NAME,
        loadSession,
        readCookie,
    } = require(`${__hooks}/auth_sessions_utils.js`);
    const cookieHeader = e.request.header.get("Cookie");
    const token = readCookie(cookieHeader, SESSION_COOKIE_NAME);
    if (!token) return e.next();

    const method = String(e.request.method || "").toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)
        && e.request.header.get("Origin") !== "https://localhost") {
        return e.json(403, { message: "Origen no permitido." });
    }

    const loaded = loadSession($app, $security, token);
    if (!loaded) {
        return e.next();
    }
    const isExchange = method === "POST" && e.request.pathValue("action") === "exchange";
    if (e.request.header.get("Authorization") && !isExchange) {
        return e.json(401, { message: "No se admiten tokens de autorización con la sesión web." });
    }

    if (!isExchange) e.auth = loaded.user;
    e.set("mtbAuthSessionId", loaded.session.id);
    e.set("mtbAuthSessionUserId", loaded.user.id);
    return e.next();
}, -1021));

routerUse(new Middleware((e) => {
    const sessionUserId = e.get("mtbAuthSessionUserId");
    const isExchange = e.request.method === "POST"
        && e.request.pathValue("action") === "exchange"
        && e.request.header.get("Origin") === "https://localhost"
        && Boolean(e.request.header.get("Authorization"));
    if (!e.auth) return e.next();
    if (sessionUserId && e.auth.id === sessionUserId && !isExchange) return e.next();
    if (isExchange) return e.next();
    if (!sessionUserId && e.hasSuperuserAuth()) return e.next();
    return e.json(401, { message: "Inicia sesión con una sesión válida." });
}, -1019));

onRecordAuthWithPasswordRequest((e) => {
    const {
        finishLoginAttempt,
        loginBucketHash,
        reserveLoginAttempt,
    } = require(`${__hooks}/auth_sessions_utils.js`);
    e.response.header().set("Cache-Control", "no-store");
    const bucketHash = loginBucketHash($security, e.realIP(), e.identity);
    const reservation = reserveLoginAttempt($app, bucketHash);
    if (reservation.retryAfter > 0) {
        e.response.header().set("Retry-After", String(reservation.retryAfter));
        throw e.tooManyRequestsError("Demasiados intentos. Espera antes de volver a intentarlo.", null);
    }

    let result;
    try {
        result = e.next();
    } catch (error) {
        finishLoginAttempt($app, bucketHash, reservation.windowStartedAt, false);
        throw error;
    }

    finishLoginAttempt($app, bucketHash, reservation.windowStartedAt, Boolean(e.record));
    return result;
}, "users");

routerAdd("POST", "/api/mtb/auth/session/{action}", (e) => {
    const {
        createSession,
        isAllowedOrigin,
        normalizeAuthorizationToken,
        publicUserRecord,
        sessionCookie,
    } = require(`${__hooks}/auth_sessions_utils.js`);
    e.response.header().set("Cache-Control", "no-store");
    const sourceToken = normalizeAuthorizationToken(e.request.header.get("Authorization"));
    if (e.request.pathValue("action") !== "exchange"
        || !isAllowedOrigin(e)
        || !sourceToken) {
        return e.json(401, { message: "No se pudo establecer una sesión válida." });
    }

    const sourceTokenKey = e.auth.tokenKey();
    const priorSessionId = e.get("mtbAuthSessionId");
    let created = null;
    let tokenKeyChanged = false;
    $app.runInTransaction((txApp) => {
        created = createSession(txApp, $security, e.auth, sourceToken);
        if (!created) return;

        const currentUser = txApp.findRecordById("users", e.auth.id);
        if (currentUser.tokenKey() !== sourceTokenKey) {
            txApp.delete(created.session);
            created = null;
            tokenKeyChanged = true;
            return;
        }

        if (priorSessionId) {
            const { markSessionRevoked } = require(`${__hooks}/auth_sessions_utils.js`);
            markSessionRevoked(txApp, priorSessionId);
        }
    });
    if (!created) {
        return e.json(401, {
            message: tokenKeyChanged
                ? "No se pudo establecer una sesión válida."
                : "El token de autenticación ya fue utilizado."
        });
    }
    e.response.header().set("Set-Cookie", sessionCookie(created.token));
    return e.json(200, { record: publicUserRecord(e.auth) });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/mtb/auth/session", (e) => {
    const { publicUserRecord } = require(`${__hooks}/auth_sessions_utils.js`);
    e.response.header().set("Cache-Control", "no-store");
    return e.json(200, { record: publicUserRecord(e.auth) });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/mtb/auth/logout", (e) => {
    const { clearSessionCookie, isAllowedOrigin, markSessionRevoked } = require(`${__hooks}/auth_sessions_utils.js`);
    e.response.header().set("Cache-Control", "no-store");
    if (!isAllowedOrigin(e)) return e.json(403, { message: "Origen no permitido." });
    const sessionId = e.get("mtbAuthSessionId");
    if (!sessionId) return e.noContent(204);
    if (!e.auth || e.get("mtbAuthSessionUserId") !== e.auth.id) {
        return e.json(401, { message: "Inicia sesión con una sesión válida." });
    }
    markSessionRevoked($app, sessionId);
    e.response.header().set("Set-Cookie", clearSessionCookie());
    return e.noContent(204);
});

onRealtimeSubscribeRequest((e) => {
    const sessionId = e.get("mtbAuthSessionId");
    if (e.hasSuperuserAuth()) {
        e.client.unset("mtbAuthSessionId");
        return e.next();
    }
    if (!e.auth) {
        e.client.unset("mtbAuthSessionId");
        return e.next();
    }

    const sessionUserId = e.get("mtbAuthSessionUserId");
    if (!sessionId || sessionUserId !== e.auth.id) {
        throw new Error("Inicia sesión con una sesión válida para suscribirte.");
    }
    e.client.set("mtbAuthSessionId", sessionId);
    return e.next();
});

onRealtimeMessageSend((e) => {
    const { loadSessionById } = require(`${__hooks}/auth_sessions_utils.js`);
    const sessionId = e.client.get("mtbAuthSessionId");
    if (!sessionId) return e.next();

    const loaded = loadSessionById(e.app, sessionId);
    const auth = e.client.get("auth");
    if (!loaded || !auth || loaded.user.id !== auth.id) {
        throw new Error("La sesión de tiempo real ya no es válida.");
    }

    return e.next();
});

onRecordUpdate((e) => {
    const { revokeUserSessions } = require(`${__hooks}/auth_sessions_utils.js`);
    const previousTokenKey = e.record.original().tokenKey();
    e.next();
    if (e.record.tokenKey() !== previousTokenKey) {
        revokeUserSessions(e.app, e.record.id);
    }
}, "users");

cronAdd("mtbAuthSessionsCleanup", "0 * * * *", () => {
    const now = Date.now();
    const batchSize = 500;
    const maxBatches = 20;
    const cleanupExpired = (collection, filter, params) => {
        for (let batch = 0; batch < maxBatches; batch++) {
            const records = $app.findRecordsByFilter(collection, filter, "", batchSize, 0, params);
            if (!records.length) return;
            for (const record of records) $app.delete(record);
        }
    };

    cleanupExpired("mtb_auth_sessions", "expiresAt <= {:now}", { now });
    cleanupExpired(
        "mtb_auth_rate_limits",
        "windowStartedAt <= {:cutoff} && blockedUntil <= {:now}",
        { cutoff: now - 24 * 60 * 60 * 1000, now }
    );
});
