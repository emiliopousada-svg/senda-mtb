'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { matchActivity } = require('../app/community-performance.js');

function rankingElement() {
    return {
        children: [],
        attributes: {},
        append(...elements) { this.children.push(...elements); },
        replaceChildren(...elements) { this.children = elements; },
        setAttribute(name, value) { this.attributes[name] = value; }
    };
}

const route = [
    [40, -3],
    [40, -2.998],
    [40, -2.996],
    [40, -2.994],
    [40, -2.992],
    [40, -2.990]
];

function activityFor(points, startMs = 1_800_000_000_000) {
    const recorded = [];
    points.slice(1).forEach((to, segmentIndex) => {
        const from = points[segmentIndex];
        const length = Math.hypot((to[0] - from[0]) * 111_000, (to[1] - from[1]) * 85_000);
        const steps = Math.ceil(length / 30);
        for (let step = 0; step < steps; step++) {
            const ratio = step / steps;
            recorded.push([
                from[0] + (to[0] - from[0]) * ratio,
                from[1] + (to[1] - from[1]) * ratio
            ]);
        }
    });
    recorded.push(points[points.length - 1]);
    return { points: recorded.map(([lat, lon], index) => [
        lat, lon, 100, startMs + index * 10_000, null, null
    ]) };
}

test('matches a complete route from timestamped GPS points', () => {
    const effort = matchActivity(activityFor(route), [route]);
    assert.equal(effort.elapsedSeconds, 300);
    assert.equal(effort.startPointIndex, 0);
    assert.equal(effort.direction, 'forward');
});

test('matches a route ridden in the opposite direction', () => {
    const effort = matchActivity(activityFor(route.slice().reverse()), [route]);
    assert.equal(effort.elapsedSeconds, 300);
    assert.equal(effort.direction, 'reverse');
});

test('matches a personal segment within a longer recorded activity', () => {
    const effort = matchActivity(activityFor(route), [route.slice(1, 5)]);
    assert.equal(effort.elapsedSeconds, 180);
});

test('rejects a partial track that does not cover the full route', () => {
    assert.equal(matchActivity(activityFor(route.slice(1, -1)), [route]), null);
});

test('rejects untimed GPS tracks instead of estimating an effort', () => {
    const activity = { points: route.map(([lat, lon]) => [lat, lon, 100, null, null, null]) };
    assert.equal(matchActivity(activity, [route]), null);
});

test('rejects tracks too far from the published route', () => {
    const displaced = route.map(([lat, lon]) => [lat + 0.01, lon]);
    assert.equal(matchActivity(activityFor(displaced), [route]), null);
});

test('rejects non-monotonic timestamps', () => {
    const activity = activityFor(route);
    activity.points[3][3] = activity.points[2][3] - 1000;
    assert.equal(matchActivity(activity, [route]), null);
});

test('rejects impossible GPS jumps', () => {
    const activity = activityFor(route);
    activity.points[3][0] += 0.02;
    assert.equal(matchActivity(activity, [route]), null);
});

test('does not match across a recorded GPS segment break', () => {
    const activity = activityFor(route);
    activity.points[20][5] = 1;
    assert.equal(matchActivity(activity, [route]), null);

    const skippedMarker = activityFor(route);
    skippedMarker.points[12][0] += 0.001;
    skippedMarker.points[12][5] = 1;
    assert.equal(matchActivity(skippedMarker, [route]), null);
});

test('keeps the faster time when an activity crosses a segment more than once', () => {
    const makePass = (startMs, elapsedSeconds, startsSegment = false) => {
        const points = activityFor(route, startMs).points;
        return points.map((point, index) => [
            point[0], point[1], point[2],
            startMs + Math.round(index / (points.length - 1) * elapsedSeconds * 1000),
            null, startsSegment && index === 0 ? 1 : null
        ]);
    };
    const slowerPass = makePass(1_800_000_000_000, 100);
    const fasterPass = makePass(slowerPass[slowerPass.length - 1][3] + 60_000, 50, true);
    const effort = matchActivity({ points: [...slowerPass, ...fasterPass] }, [route]);

    assert.equal(effort.elapsedSeconds, 50);
    assert.equal(effort.startPointIndex, slowerPass.length);
});

test('matches each repeated pass only within its continuous GPS segment', () => {
    const makePass = (startMs, elapsedSeconds, startsSegment = false) => {
        const points = activityFor(route, startMs).points;
        return points.map((point, index) => [
            point[0], point[1], point[2],
            startMs + Math.round(index / (points.length - 1) * elapsedSeconds * 1000),
            null, startsSegment && index === 0 ? 1 : null
        ]);
    };
    const slowerPass = makePass(1_800_000_000_000, 60);
    slowerPass[5][0] += 0.00015;
    const betterAlignedPass = makePass(slowerPass[slowerPass.length - 1][3] + 60_000, 120, true);
    const effort = matchActivity({ points: [...slowerPass, ...betterAlignedPass] }, [route]);

    assert.equal(effort.elapsedSeconds, 60);
    assert.equal(effort.startPointIndex, 0);
});

test('route detail omits route rankings and saved activity publication while segment rankings remain', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const routes = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-routes.js'), 'utf8');
    const performanceUi = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-performance-ui.js'), 'utf8');
    const segments = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-segments.js'), 'utf8');
    assert.doesNotMatch(html, /id="community-route-attempt"/);
    assert.doesNotMatch(html, /id="community-route-ranking-section"/);
    assert.doesNotMatch(routes, /communityRenderEffortWidget/);
    assert.doesNotMatch(routes, /communityLoadRanking/);
    assert.doesNotMatch(performanceUi, /community-route-leaderboard/);
    assert.match(performanceUi, /function communityRenderPersonalBest/);
    assert.match(segments, /communityLoadSegmentRanking/);
});

test('segment podium renders the three fastest marks with medals', () => {
    const performanceUi = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-performance-ui.js'), 'utf8');
    const context = require('node:vm').createContext({
        document: { createElement: rankingElement },
        fmtDur: seconds => `${seconds}s`
    });
    require('node:vm').runInContext(performanceUi, context);
    const container = rankingElement();
    context.communityRenderRanking([
        { alias: 'Ciclista 4', elapsedSeconds: 240 },
        { alias: 'Ciclista 2', elapsedSeconds: 120 },
        { alias: 'Ciclista 1', elapsedSeconds: 60 },
        { alias: 'Ciclista 3', elapsedSeconds: 180 }
    ], container, 4, { limit: 3, podium: true });

    assert.deepEqual(container.children.map(row => [
        row.children[0].textContent,
        row.children[1].textContent,
        row.children[2].textContent
    ]), [
        ['🥇', 'Ciclista 1', '60s'],
        ['🥈', 'Ciclista 2', '120s'],
        ['🥉', 'Ciclista 3', '180s']
    ]);
});

test('segment ranking loads a limited public podium and the signed-in user best separately', async () => {
    const context = require('node:vm').createContext({
        document: { createElement: rankingElement },
        fmtDur: seconds => `${seconds}s`,
        Cloud: { loggedIn: () => true, uid: 'user-1' }
    });
    require('node:vm').runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'community-performance-ui.js'), 'utf8'),
        context
    );
    const requests = [];
    context.cloudApi = async url => {
        requests.push(url);
        const filter = decodeURIComponent(url.split('&filter=')[1]);
        if (filter.includes('owner =')) {
            return { items: [{ alias: 'Mi apodo', elapsedSeconds: 240 }], totalItems: 1 };
        }
        return {
            items: [
                { alias: 'Primer puesto', elapsedSeconds: 60 },
                { alias: 'Segundo puesto', elapsedSeconds: 120 },
                { alias: 'Tercer puesto', elapsedSeconds: 180 }
            ],
            totalItems: 40
        };
    };
    const podium = rankingElement();
    const personal = rankingElement();
    podium.isConnected = personal.isConnected = true;

    await context.communityLoadSegmentRanking({ id: 'segment-1', title: 'Bajada' }, podium, personal);

    assert.equal(requests.length, 2);
    assert.ok(requests.some(url => url.includes('perPage=3') && !decodeURIComponent(url).includes('owner =')));
    assert.ok(requests.some(url => url.includes('perPage=1') && decodeURIComponent(url).includes('owner = "user-1"')));
    assert.deepEqual(podium.children.slice(0, 3).map(row => row.children[1].textContent), [
        'Primer puesto', 'Segundo puesto', 'Tercer puesto'
    ]);
    assert.equal(personal.children.find(element => element.className === 'community-personal-best-time').textContent, '240s');
});

test('segment ranking discards a personal response after the account changes', async () => {
    const cloud = {
        uid: 'user-a',
        server: 'https://server-a.example',
        authGeneration: 1,
        loggedIn: () => true
    };
    const context = require('node:vm').createContext({
        document: { createElement: rankingElement },
        fmtDur: seconds => `${seconds}s`,
        Cloud: cloud
    });
    require('node:vm').runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'community-performance-ui.js'), 'utf8'),
        context
    );
    const resolvePersonal = [];
    const personalRequests = [];
    context.cloudApi = url => {
        if (decodeURIComponent(url).includes('owner =')) {
            personalRequests.push(url);
            return new Promise(resolve => { resolvePersonal.push(resolve); });
        }
        return Promise.resolve({ items: [], totalItems: 0 });
    };
    const podium = rankingElement();
    const personal = rankingElement();
    podium.isConnected = personal.isConnected = true;

    const loading = context.communityLoadSegmentRanking({ id: 'segment-1' }, podium, personal);
    cloud.uid = 'user-b';
    cloud.server = 'https://server-b.example';
    cloud.authGeneration++;
    resolvePersonal[0]({ items: [{ alias: 'Cuenta A', elapsedSeconds: 123 }], totalItems: 1 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolvePersonal.length, 2);
    resolvePersonal[1]({ items: [{ alias: 'Cuenta B', elapsedSeconds: 222 }], totalItems: 1 });
    await loading;

    assert.ok(decodeURIComponent(personalRequests[0]).includes('owner = "user-a"'));
    assert.ok(decodeURIComponent(personalRequests[1]).includes('owner = "user-b"'));
    assert.equal(personal.children.find(element => element.className === 'community-personal-best-time').textContent, '222s');
});

test('segment podium reloads from the current server after a server switch', async () => {
    const cloud = { server: 'https://server-a.example', loggedIn: () => false };
    const context = require('node:vm').createContext({
        document: { createElement: rankingElement },
        fmtDur: seconds => `${seconds}s`,
        Cloud: cloud
    });
    require('node:vm').runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'community-performance-ui.js'), 'utf8'),
        context
    );
    let resolveOldServer;
    let requests = 0;
    context.cloudApi = () => {
        requests++;
        if (requests === 1) {
            return new Promise(resolve => { resolveOldServer = resolve; });
        }
        return Promise.resolve({
            items: [{ alias: 'Servidor actual', elapsedSeconds: 90 }],
            totalItems: 1
        });
    };
    const podium = rankingElement();
    const personal = rankingElement();
    podium.isConnected = personal.isConnected = true;

    const loading = context.communityLoadSegmentRanking({ id: 'segment-1' }, podium, personal);
    cloud.server = 'https://server-b.example';
    resolveOldServer({
        items: [{ alias: 'Servidor anterior', elapsedSeconds: 30 }],
        totalItems: 1
    });
    await loading;

    assert.equal(requests, 2);
    assert.equal(podium.children[0].children[1].textContent, 'Servidor actual');
});
