'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeRecord {
    constructor(collection) {
        this.collectionName = collection;
        this.id = '';
        this.fields = {};
    }

    set(name, value) { this.fields[name] = value; }
    getInt(name) { return Number(this.fields[name] || 0); }
    getBool(name) { return Boolean(this.fields[name]); }
    getString(name) { return String(this.fields[name] || ''); }
    ignoreEmailVisibility() {}
    publicExport() { return { id: this.id, ...this.fields, password: 'hidden', tokenKey: 'hidden' }; }
}

class FakeApp {
    constructor() {
        this.records = {
            mtb_auth_sessions: [],
            mtb_auth_rate_limits: [],
            users: [{ id: 'user-1', getString: () => 'user-1' }]
        };
        this.nextId = 1;
    }

    findCollectionByNameOrId(name) { return name; }

    findRecordsByFilter(collection, filter, _sort, limit, offset, params) {
        let records = this.records[collection] || [];
        if (filter.includes('tokenHash')) records = records.filter(record => record.fields.tokenHash === params.hash);
        else if (filter.includes('sourceTokenHash')) records = records.filter(record => record.fields.sourceTokenHash === params.hash);
        else if (filter.includes('bucketHash')) records = records.filter(record => record.fields.bucketHash === params.hash);
        else if (filter.includes('id =')) records = records.filter(record => record.id === params.id);
        else if (filter.includes('expiresAt <=')) records = records.filter(record => record.fields.expiresAt <= params.now);
        else if (filter.includes('windowStartedAt <=')) {
            records = records.filter(record => record.fields.windowStartedAt <= params.cutoff
                && record.fields.blockedUntil <= params.now);
        }
        else if (filter.includes('owner')) {
            records = records.filter(record => record.fields.owner === params.owner && !record.fields.revoked);
        }
        return records.slice(offset, offset + limit);
    }

    findRecordById(collection, id) {
        const record = (this.records[collection] || []).find(item => item.id === id);
        if (!record) throw new Error(`Missing ${collection} record ${id}`);
        return record;
    }

    save(record) {
        const collection = this.records[record.collectionName];
        if (!record.id) {
            record.id = `${record.collectionName}-${this.nextId++}`;
            collection.push(record);
        }
    }

    delete(record) {
        this.records[record.collectionName] = this.records[record.collectionName]
            .filter(item => item !== record);
    }

    runInTransaction(callback) { return callback(this); }
}

function authUtils() {
    const context = vm.createContext({ module: { exports: {} }, Record: FakeRecord });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'auth_sessions_utils.js'), 'utf8'),
        context
    );
    return context.module.exports;
}

function fakeSecurity() {
    let counter = 0;
    return {
        sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); },
        randomString(length) { counter += 1; return `T${counter}`.padEnd(length, 'A'); }
    };
}

function authUser(id) {
    return {
        id,
        currentTokenKey: 'token-key-1',
        tokenKey() { return this.currentTokenKey; },
        ignoreEmailVisibility() {},
        publicExport() { return { id }; }
    };
}

function authHook(utils, app, security) {
    const captured = {
        middlewares: [],
        routes: [],
        authHandlers: [],
        realtimeSubscribeRequest: null,
        realtimeMessageSend: null,
        cronJobs: []
    };
    const context = vm.createContext({
        __hooks: 'hooks',
        $app: app,
        $security: security,
        $apis: { requireAuth() { return () => {}; } },
        Middleware: class {
            constructor(handler, priority) { this.handler = handler; this.priority = priority; }
        },
        require() { return utils; },
        routerUse(middleware) { captured.middlewares.push(middleware); },
        routerAdd(method, route, handler) { captured.routes.push({ method, route, handler }); },
        onRecordAuthWithPasswordRequest(handler) { captured.authHandlers.push(handler); },
        onRealtimeSubscribeRequest(handler) { captured.realtimeSubscribeRequest = handler; },
        onRealtimeMessageSend(handler) { captured.realtimeMessageSend = handler; },
        onRecordUpdate() {},
        cronAdd(id, expression, handler) { captured.cronJobs.push({ id, expression, handler }); }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'pb_hooks', 'auth_sessions.pb.js'), 'utf8'),
        context
    );
    return captured;
}

function requestEvent({ cookie = '', origin = '', authorization = '', method = 'GET', action = '' } = {}) {
    const values = new Map();
    const headers = {
        Cookie: cookie,
        Origin: origin,
        Authorization: authorization
    };
    const event = {
        request: {
            method,
            header: { get(name) { return headers[name] || ''; } },
            pathValue(name) { return name === 'action' ? action : ''; }
        },
        response: { header() { return { set(name, value) { headers[name] = value; } }; } },
        auth: null,
        nextCalled: false,
        next() { this.nextCalled = true; },
        set(name, value) { values.set(name, value); },
        get(name) { return values.get(name); },
        hasSuperuserAuth() { return false; },
        json(status, body) { this.result = { status, body }; return this.result; },
        noContent(status) { this.result = { status }; return this.result; },
        get headers() { return headers; }
    };
    return event;
}

test('session cookies are host-only, HttpOnly, Secure, and SameSite=None', () => {
    const utils = authUtils();
    assert.equal(utils.readCookie('theme=dark; __Host-mtb_session=secret; other=x', utils.SESSION_COOKIE_NAME), 'secret');
    assert.match(utils.sessionCookie('secret'), /Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=None/);
    assert.doesNotMatch(utils.sessionCookie('secret'), /Domain=/i);
    assert.match(utils.clearSessionCookie(), /Max-Age=0; HttpOnly; Secure; SameSite=None/);
});

test('session records store hashes, expire, and cannot be replayed after revocation', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const now = 1_800_000_000_000;
    const user = { id: 'user-1' };
    const created = utils.createSession(app, security, user, 'pocketbase-jwt', now);

    assert.notEqual(created.token, app.records.mtb_auth_sessions[0].fields.tokenHash);
    assert.notEqual('pocketbase-jwt', app.records.mtb_auth_sessions[0].fields.sourceTokenHash);
    assert.equal(app.records.mtb_auth_sessions[0].fields.expiresAt, now + utils.SESSION_TTL_MS);
    assert.equal(utils.loadSession(app, security, created.token, now).user.id, 'user-1');
    assert.equal(utils.createSession(app, security, user, 'pocketbase-jwt', now), null);

    utils.markSessionRevoked(app, created.session.id);
    assert.equal(utils.loadSession(app, security, created.token, now), null);
    assert.equal(app.records.mtb_auth_sessions[0].fields.revoked, true);
    assert.equal(utils.createSession(app, security, user, 'pocketbase-jwt', now), null);
});

test('revoked sessions cannot receive realtime messages on a cookie-less open connection', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const user = authUser('user-1');
    app.records.users = [user];
    const created = utils.createSession(app, security, user, 'jwt-1');
    const { middlewares, realtimeSubscribeRequest, realtimeMessageSend } = authHook(utils, app, security);
    const sessionMiddleware = middlewares.find(item => item.priority === -1021).handler;
    const authMiddleware = middlewares.find(item => item.priority === -1019).handler;
    const clientValues = new Map();
    const client = {
        get(key) { return clientValues.get(key); },
        set(key, value) { clientValues.set(key, value); },
        unset(key) { clientValues.delete(key); }
    };
    const subscription = requestEvent({
        cookie: `${utils.SESSION_COOKIE_NAME}=${created.token}`,
        origin: utils.APP_ORIGIN,
        method: 'POST'
    });
    sessionMiddleware(subscription);
    authMiddleware(subscription);
    subscription.client = client;
    subscription.next = () => {
        client.set('auth', subscription.auth);
        return null;
    };
    realtimeSubscribeRequest(subscription);
    assert.equal(client.get('mtbAuthSessionId'), created.session.id);

    const message = requestEvent();
    message.app = app;
    message.client = client;
    message.message = { name: 'private-record-event' };
    realtimeMessageSend(message);
    assert.equal(message.nextCalled, true);

    utils.markSessionRevoked(app, created.session.id);
    const revokedMessage = requestEvent();
    revokedMessage.app = app;
    revokedMessage.client = client;
    revokedMessage.message = { name: 'private-record-event' };
    assert.throws(() => realtimeMessageSend(revokedMessage), /sesión de tiempo real ya no es válida/);
    assert.equal(revokedMessage.nextCalled, false);
});

test('anonymous realtime handshakes remain allowed but authenticated subscriptions need a session', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const user = authUser('user-1');
    app.records.users = [user];
    const { realtimeSubscribeRequest, realtimeMessageSend } = authHook(utils, app, security);
    const values = new Map();
    const client = {
        get(key) { return values.get(key); },
        set(key, value) { values.set(key, value); },
        unset(key) { values.delete(key); }
    };

    const connect = requestEvent();
    connect.app = app;
    connect.client = client;
    connect.message = { name: 'PB_CONNECT' };
    realtimeMessageSend(connect);
    assert.equal(connect.nextCalled, true);

    const anonymousSubscription = requestEvent();
    anonymousSubscription.client = client;
    realtimeSubscribeRequest(anonymousSubscription);
    assert.equal(anonymousSubscription.nextCalled, true);

    const authenticatedSubscription = requestEvent();
    authenticatedSubscription.auth = user;
    authenticatedSubscription.client = client;
    assert.throws(
        () => realtimeSubscribeRequest(authenticatedSubscription),
        /sesión válida para suscribirte/
    );
    assert.equal(authenticatedSubscription.nextCalled, false);
});

test('expired sessions are deleted and no longer authenticate', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const now = 1_800_000_000_000;
    const created = utils.createSession(app, security, { id: 'user-1' }, 'jwt-1', now);

    assert.equal(utils.loadSession(app, security, created.token, now + utils.SESSION_TTL_MS), null);
    assert.equal(app.records.mtb_auth_sessions.length, 0);
});

test('session cleanup drains multiple expired-record batches in one run', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    app.records.mtb_auth_sessions = Array.from({ length: 501 }, (_value, index) => {
        const record = new FakeRecord('mtb_auth_sessions');
        record.id = `session-${index}`;
        record.fields.expiresAt = 0;
        return record;
    });
    const activeSession = new FakeRecord('mtb_auth_sessions');
    activeSession.id = 'active-session';
    activeSession.fields.expiresAt = Number.MAX_SAFE_INTEGER;
    app.records.mtb_auth_sessions.push(activeSession);
    app.records.mtb_auth_rate_limits = Array.from({ length: 501 }, (_value, index) => {
        const record = new FakeRecord('mtb_auth_rate_limits');
        record.id = `limit-${index}`;
        record.fields.windowStartedAt = 0;
        record.fields.blockedUntil = 0;
        return record;
    });
    const activeLimit = new FakeRecord('mtb_auth_rate_limits');
    activeLimit.id = 'active-limit';
    activeLimit.fields.windowStartedAt = Date.now();
    activeLimit.fields.blockedUntil = Date.now() + 60_000;
    app.records.mtb_auth_rate_limits.push(activeLimit);
    const { cronJobs } = authHook(utils, app, security);

    cronJobs.find(job => job.id === 'mtbAuthSessionsCleanup').handler();

    assert.deepEqual(app.records.mtb_auth_sessions.map(record => record.id), ['active-session']);
    assert.deepEqual(app.records.mtb_auth_rate_limits.map(record => record.id), ['active-limit']);
});

test('login reservations block after ten failures and unblock after the rate window', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const bucket = utils.loginBucketHash(security, '192.0.2.10', 'rider@example.com');
    const now = 1_800_000_000_000;

    for (let attempt = 0; attempt < utils.LOGIN_MAX_ATTEMPTS; attempt++) {
        const reservation = utils.reserveLoginAttempt(app, bucket, now + attempt);
        assert.equal(reservation.retryAfter, 0);
        utils.finishLoginAttempt(app, bucket, reservation.windowStartedAt, false, now + attempt);
    }

    assert.equal(utils.reserveLoginAttempt(app, bucket, now + 10).retryAfter, 900);
    assert.equal(utils.reserveLoginAttempt(app, bucket, now + utils.LOGIN_BLOCK_MS + 10).retryAfter, 0);
});

test('login lockout lasts from the final failed attempt even when the window has elapsed', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const bucket = utils.loginBucketHash(security, '192.0.2.10', 'rider@example.com');
    const now = 1_800_000_000_000;

    for (let attempt = 0; attempt < utils.LOGIN_MAX_ATTEMPTS - 1; attempt++) {
        const reservation = utils.reserveLoginAttempt(app, bucket, now);
        utils.finishLoginAttempt(app, bucket, reservation.windowStartedAt, false, now);
    }
    const lastAttemptAt = now + utils.LOGIN_WINDOW_MS - 1000;
    const lastReservation = utils.reserveLoginAttempt(app, bucket, lastAttemptAt);
    utils.finishLoginAttempt(app, bucket, lastReservation.windowStartedAt, false, lastAttemptAt);

    const duringLockout = utils.reserveLoginAttempt(app, bucket, now + utils.LOGIN_WINDOW_MS + 1000);
    assert.ok(duringLockout.retryAfter > 800);
    assert.equal(
        utils.reserveLoginAttempt(app, bucket, lastAttemptAt + utils.LOGIN_BLOCK_MS).retryAfter,
        0
    );
});

test('a successful login only clears failures for its own account and source IP', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const targetBucket = utils.loginBucketHash(security, '192.0.2.10', 'victim@example.com');
    const ownBucket = utils.loginBucketHash(security, '192.0.2.10', 'attacker@example.com');
    const now = 1_800_000_000_000;

    for (let attempt = 0; attempt < utils.LOGIN_MAX_ATTEMPTS - 1; attempt++) {
        const reservation = utils.reserveLoginAttempt(app, targetBucket, now + attempt);
        utils.finishLoginAttempt(app, targetBucket, reservation.windowStartedAt, false, now + attempt);
    }
    const ownReservation = utils.reserveLoginAttempt(app, ownBucket, now);
    utils.finishLoginAttempt(app, ownBucket, ownReservation.windowStartedAt, true, now);

    const targetReservation = utils.reserveLoginAttempt(app, targetBucket, now + 10);
    assert.equal(targetReservation.retryAfter, 0);
    utils.finishLoginAttempt(app, targetBucket, targetReservation.windowStartedAt, false, now + 10);
    assert.equal(utils.reserveLoginAttempt(app, targetBucket, now + 11).retryAfter, 900);
});

test('pending login reservations do not exceed the attempt limit', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const bucket = utils.loginBucketHash(security, '192.0.2.10', 'rider@example.com');
    const now = 1_800_000_000_000;
    const reservations = Array.from({ length: 100 }, () => utils.reserveLoginAttempt(app, bucket, now));
    const allowed = reservations.filter(reservation => reservation.retryAfter === 0);

    assert.equal(allowed.length, utils.LOGIN_MAX_ATTEMPTS);
    assert.equal(app.records.mtb_auth_rate_limits[0].fields.pendingAttemptCount, utils.LOGIN_MAX_ATTEMPTS);
    for (const reservation of allowed) {
        utils.finishLoginAttempt(app, bucket, reservation.windowStartedAt, false, now);
    }
    assert.equal(app.records.mtb_auth_rate_limits[0].fields.pendingAttemptCount, 0);
    assert.equal(utils.reserveLoginAttempt(app, bucket, now + 1).retryAfter, 900);
});

test('password auth hook delegates password verification to PocketBase', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const { authHandlers } = authHook(utils, app, security);
    const event = requestEvent();
    event.identity = 'rider@example.com';
    event.realIP = () => '192.0.2.10';
    event.record = { validatePassword() { throw new Error('must not validate twice'); } };
    event.next = () => { throw new Error('invalid credentials'); };

    assert.throws(() => authHandlers[0](event), /invalid credentials/);
    const bucket = utils.loginBucketHash(security, '192.0.2.10', 'rider@example.com');
    assert.equal(app.records.mtb_auth_rate_limits[0].fields.bucketHash, bucket);
    assert.equal(app.records.mtb_auth_rate_limits[0].fields.attemptCount, 1);
    assert.equal(app.records.mtb_auth_rate_limits[0].fields.pendingAttemptCount, 0);
});

test('auth middleware accepts a valid cookie but rejects CSRF and bearer-only requests', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const created = utils.createSession(app, security, { id: 'user-1' }, 'jwt-1');
    const { middlewares } = authHook(utils, app, security);
    const sessionMiddleware = middlewares.find(item => item.priority === -1021).handler;
    const authMiddleware = middlewares.find(item => item.priority === -1019).handler;

    const cookieEvent = requestEvent({
        cookie: `${utils.SESSION_COOKIE_NAME}=${created.token}`,
        origin: utils.APP_ORIGIN
    });
    sessionMiddleware(cookieEvent);
    authMiddleware(cookieEvent);
    assert.equal(cookieEvent.auth.id, 'user-1');
    assert.equal(cookieEvent.nextCalled, true);

    const csrfEvent = requestEvent({
        cookie: `${utils.SESSION_COOKIE_NAME}=${created.token}`,
        origin: 'https://attacker.example',
        method: 'POST'
    });
    sessionMiddleware(csrfEvent);
    assert.equal(csrfEvent.result.status, 403);

    const revoked = utils.createSession(app, security, { id: 'user-1' }, 'jwt-revoked');
    utils.markSessionRevoked(app, revoked.session.id);
    const revokedEvent = requestEvent({
        cookie: `${utils.SESSION_COOKIE_NAME}=${revoked.token}`,
        origin: utils.APP_ORIGIN
    });
    sessionMiddleware(revokedEvent);
    assert.equal(revokedEvent.auth, null);
    assert.equal(revokedEvent.nextCalled, true);
    assert.equal(revokedEvent.get('mtbAuthSessionId'), undefined);

    const bearerEvent = requestEvent();
    bearerEvent.auth = { id: 'user-1' };
    authMiddleware(bearerEvent);
    assert.equal(bearerEvent.result.status, 401);

    const exchangeEvent = requestEvent({
        origin: utils.APP_ORIGIN,
        authorization: 'pocketbase-jwt',
        method: 'POST',
        action: 'exchange'
    });
    exchangeEvent.auth = { id: 'user-1' };
    authMiddleware(exchangeEvent);
    assert.equal(exchangeEvent.nextCalled, true);
});

test('logout does not clear a revoked session cookie', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const created = utils.createSession(app, security, { id: 'user-1' }, 'jwt-1');
    utils.markSessionRevoked(app, created.session.id);
    const { middlewares, routes } = authHook(utils, app, security);
    const sessionMiddleware = middlewares.find(item => item.priority === -1021).handler;
    const event = requestEvent({
        cookie: `${utils.SESSION_COOKIE_NAME}=${created.token}`,
        origin: utils.APP_ORIGIN,
        method: 'POST'
    });
    const logout = routes.find(route => route.route === '/api/mtb/auth/logout').handler;

    sessionMiddleware(event);
    const result = logout(event);

    assert.equal(result.status, 204);
    assert.equal(event.headers['Set-Cookie'], undefined);
});

test('logout without a cookie does not emit a cookie header', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const { routes } = authHook(utils, app, fakeSecurity());
    const event = requestEvent({ origin: utils.APP_ORIGIN, method: 'POST' });
    const logout = routes.find(route => route.route === '/api/mtb/auth/logout').handler;

    const result = logout(event);

    assert.equal(result.status, 204);
    assert.equal(event.headers['Set-Cookie'], undefined);
});

test('logout revokes a valid session and expires its cookie', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const created = utils.createSession(app, security, { id: 'user-1' }, 'jwt-1');
    const { middlewares, routes } = authHook(utils, app, security);
    const sessionMiddleware = middlewares.find(item => item.priority === -1021).handler;
    const event = requestEvent({
        cookie: `${utils.SESSION_COOKIE_NAME}=${created.token}`,
        origin: utils.APP_ORIGIN,
        method: 'POST'
    });
    const logout = routes.find(route => route.route === '/api/mtb/auth/logout').handler;

    sessionMiddleware(event);
    const result = logout(event);

    assert.equal(result.status, 204);
    assert.equal(created.session.fields.revoked, true);
    assert.match(event.headers['Set-Cookie'], /Max-Age=0/);
});

test('session exchange uses the user authenticated by its bearer token', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const userA = authUser('user-a');
    const userB = authUser('user-b');
    app.records.users = [userA, userB];
    const existing = utils.createSession(app, security, userA, 'jwt-a');
    const { middlewares, routes } = authHook(utils, app, security);
    const sessionMiddleware = middlewares.find(item => item.priority === -1021).handler;
    const authMiddleware = middlewares.find(item => item.priority === -1019).handler;
    const exchangeRoute = routes.find(route => route.method === 'POST').handler;
    const event = requestEvent({
        cookie: `${utils.SESSION_COOKIE_NAME}=${existing.token}`,
        origin: utils.APP_ORIGIN,
        authorization: 'jwt-b',
        method: 'POST',
        action: 'exchange'
    });

    sessionMiddleware(event);
    assert.equal(event.auth, null);
    event.auth = userB;
    authMiddleware(event);
    exchangeRoute(event);

    const newSession = app.records.mtb_auth_sessions.find(session => session.fields.sourceTokenHash
        === security.sha256('jwt-b'));
    assert.equal(event.result.status, 200);
    assert.equal(event.result.body.record.id, 'user-b');
    assert.equal(newSession.fields.owner, 'user-b');
    assert.equal(existing.session.fields.revoked, true);
});

test('session exchange does not issue a session if the user token key changes concurrently', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const user = authUser('user-a');
    app.records.users = [user];
    const save = app.save.bind(app);
    app.save = record => {
        save(record);
        if (record.collectionName === 'mtb_auth_sessions') user.currentTokenKey = 'token-key-2';
    };
    const { routes } = authHook(utils, app, security);
    const exchangeRoute = routes.find(route => route.method === 'POST').handler;
    const event = requestEvent({
        origin: utils.APP_ORIGIN,
        authorization: 'jwt-a',
        method: 'POST',
        action: 'exchange'
    });
    event.auth = user;

    exchangeRoute(event);

    assert.equal(event.result.status, 401);
    assert.equal(event.headers['Set-Cookie'], undefined);
    assert.equal(app.records.mtb_auth_sessions.length, 0);
});

test('session exchange rejects a JWT replayed with the Bearer prefix', () => {
    const utils = authUtils();
    const app = new FakeApp();
    const security = fakeSecurity();
    const user = authUser('user-a');
    app.records.users = [user];
    utils.createSession(app, security, user, 'jwt-a');
    const { routes } = authHook(utils, app, security);
    const exchangeRoute = routes.find(route => route.method === 'POST').handler;
    const event = requestEvent({
        origin: utils.APP_ORIGIN,
        authorization: 'Bearer jwt-a',
        method: 'POST',
        action: 'exchange'
    });
    event.auth = user;

    exchangeRoute(event);

    assert.equal(utils.normalizeAuthorizationToken('bEaReR jwt-a'), 'jwt-a');
    assert.equal(event.result.status, 401);
    assert.equal(app.records.mtb_auth_sessions.length, 1);
});

test('safe auth responses include the account email without exposing password fields', () => {
    const utils = authUtils();
    const record = new FakeRecord('users');
    record.id = 'user-1';
    record.fields = { email: 'rider@example.com', nickname: 'Rider' };

    const result = utils.publicUserRecord(record);
    assert.equal(result.email, 'rider@example.com');
    assert.equal(result.nickname, 'Rider');
    assert.equal(Object.hasOwn(result, 'password'), false);
    assert.equal(Object.hasOwn(result, 'tokenKey'), false);
});
