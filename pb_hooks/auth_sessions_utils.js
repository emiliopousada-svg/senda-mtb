const SESSION_COOKIE_NAME = "__Host-mtb_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const APP_ORIGIN = "https://localhost";

function readCookie(header, name) {
    for (const item of String(header || "").split(";")) {
        const separator = item.indexOf("=");
        if (separator < 0) continue;
        if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
    }
    return "";
}

function sessionCookie(token, maxAgeSeconds = SESSION_TTL_MS / 1000) {
    return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=None`;
}

function clearSessionCookie() {
    return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`;
}

function isAllowedOrigin(event) {
    return event.request.header.get("Origin") === APP_ORIGIN;
}

function normalizeAuthorizationToken(header) {
    return String(header || "").trim().replace(/^Bearer\s+/i, "").trim();
}

function createSession(app, security, user, sourceToken, now = Date.now()) {
    const token = security.randomString(64);
    const sourceTokenHash = security.sha256(sourceToken);
    const usedTokens = app.findRecordsByFilter(
        "mtb_auth_sessions",
        "sourceTokenHash = {:hash}",
        "",
        1,
        0,
        { hash: sourceTokenHash }
    );
    if (usedTokens.length) return null;

    const session = new Record(app.findCollectionByNameOrId("mtb_auth_sessions"));
    session.set("owner", user.id);
    session.set("tokenHash", security.sha256(token));
    session.set("sourceTokenHash", sourceTokenHash);
    session.set("expiresAt", now + SESSION_TTL_MS);
    session.set("revoked", false);
    app.save(session);
    return { token, session };
}

function loadSession(app, security, token, now = Date.now()) {
    if (!/^[A-Za-z0-9]{64}$/.test(token)) return null;
    const records = app.findRecordsByFilter(
        "mtb_auth_sessions",
        "tokenHash = {:hash}",
        "",
        1,
        0,
        { hash: security.sha256(token) }
    );
    if (!records.length) return null;

    const session = records[0];
    if (session.getBool("revoked")) return null;
    if (session.getInt("expiresAt") <= now) {
        app.delete(session);
        return null;
    }

    return {
        session,
        user: app.findRecordById("users", session.getString("owner")),
    };
}

function loadSessionById(app, sessionId, now = Date.now()) {
    const records = app.findRecordsByFilter(
        "mtb_auth_sessions",
        "id = {:id}",
        "",
        1,
        0,
        { id: sessionId }
    );
    if (!records.length) return null;

    const session = records[0];
    if (session.getBool("revoked")) return null;
    if (session.getInt("expiresAt") <= now) {
        app.delete(session);
        return null;
    }

    return {
        session,
        user: app.findRecordById("users", session.getString("owner")),
    };
}

function loginBucketHash(security, ip, identity = "") {
    const normalizedIdentity = String(identity || "").trim().toLowerCase();
    return security.sha256(`${String(ip || "unknown")}\n${normalizedIdentity}`);
}

function reserveLoginAttempt(app, bucketHash, now = Date.now()) {
    let reservation = { retryAfter: 0, windowStartedAt: 0 };
    app.runInTransaction((txApp) => {
        const records = txApp.findRecordsByFilter(
            "mtb_auth_rate_limits",
            "bucketHash = {:hash}",
            "",
            1,
            0,
            { hash: bucketHash }
        );
        const record = records[0] || new Record(txApp.findCollectionByNameOrId("mtb_auth_rate_limits"));
        let windowStartedAt = record.getInt("windowStartedAt");
        let attempts = record.getInt("attemptCount");
        let pendingAttempts = record.getInt("pendingAttemptCount");
        let blockedUntil = record.getInt("blockedUntil");
        if (blockedUntil > now) {
            reservation = { retryAfter: Math.ceil((blockedUntil - now) / 1000), windowStartedAt };
            return;
        }
        if (!windowStartedAt || now - windowStartedAt >= LOGIN_WINDOW_MS) {
            windowStartedAt = now;
            attempts = 0;
            pendingAttempts = 0;
            blockedUntil = 0;
        }
        if (blockedUntil > now || attempts >= LOGIN_MAX_ATTEMPTS) {
            if (blockedUntil <= now) blockedUntil = now + LOGIN_BLOCK_MS;
            record.set("bucketHash", bucketHash);
            record.set("windowStartedAt", windowStartedAt);
            record.set("attemptCount", attempts);
            record.set("pendingAttemptCount", pendingAttempts);
            record.set("blockedUntil", blockedUntil);
            txApp.save(record);
            reservation = { retryAfter: Math.ceil((blockedUntil - now) / 1000), windowStartedAt };
            return;
        }

        attempts += 1;
        pendingAttempts += 1;
        if (attempts >= LOGIN_MAX_ATTEMPTS) blockedUntil = now + LOGIN_BLOCK_MS;
        record.set("bucketHash", bucketHash);
        record.set("windowStartedAt", windowStartedAt);
        record.set("attemptCount", attempts);
        record.set("pendingAttemptCount", pendingAttempts);
        record.set("blockedUntil", blockedUntil);
        txApp.save(record);
        reservation = { retryAfter: 0, windowStartedAt };
    });
    return reservation;
}

function finishLoginAttempt(app, bucketHash, windowStartedAt, succeeded, now = Date.now()) {
    app.runInTransaction((txApp) => {
        const records = txApp.findRecordsByFilter(
            "mtb_auth_rate_limits",
            "bucketHash = {:hash}",
            "",
            1,
            0,
            { hash: bucketHash }
        );
        if (!records.length || records[0].getInt("windowStartedAt") !== windowStartedAt) return;

        const record = records[0];
        const pendingAttempts = Math.max(0, record.getInt("pendingAttemptCount") - 1);
        let attempts = record.getInt("attemptCount");
        let blockedUntil = record.getInt("blockedUntil");
        if (succeeded) {
            attempts = pendingAttempts;
            blockedUntil = 0;
            if (pendingAttempts === 0) {
                txApp.delete(record);
                return;
            }
        } else if (attempts >= LOGIN_MAX_ATTEMPTS) {
            blockedUntil = Math.max(blockedUntil, now + LOGIN_BLOCK_MS);
        }
        record.set("attemptCount", attempts);
        record.set("pendingAttemptCount", pendingAttempts);
        record.set("blockedUntil", blockedUntil);
        txApp.save(record);
    });
}

function markSessionRevoked(app, sessionId) {
    const session = app.findRecordById("mtb_auth_sessions", sessionId);
    if (session.getBool("revoked")) return;
    session.set("revoked", true);
    app.save(session);
}

function revokeUserSessions(app, userId) {
    while (true) {
        const sessions = app.findRecordsByFilter(
            "mtb_auth_sessions",
            "owner = {:owner} && revoked = false",
            "",
            500,
            0,
            { owner: userId }
        );
        if (!sessions.length) return;
        for (const session of sessions) {
            session.set("revoked", true);
            app.save(session);
        }
    }
}

function publicUserRecord(record) {
    record.ignoreEmailVisibility(true);
    const result = record.publicExport();
    delete result.password;
    delete result.tokenKey;
    return result;
}

module.exports = {
    APP_ORIGIN,
    LOGIN_BLOCK_MS,
    LOGIN_MAX_ATTEMPTS,
    LOGIN_WINDOW_MS,
    SESSION_COOKIE_NAME,
    SESSION_TTL_MS,
    clearSessionCookie,
    createSession,
    finishLoginAttempt,
    isAllowedOrigin,
    loadSession,
    loadSessionById,
    loginBucketHash,
    markSessionRevoked,
    normalizeAuthorizationToken,
    publicUserRecord,
    readCookie,
    reserveLoginAttempt,
    revokeUserSessions,
    sessionCookie,
};
