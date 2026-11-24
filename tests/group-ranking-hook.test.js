'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const groupUtils = require('../pb_hooks/groups_utils.js');

const hookSource = fs.readFileSync(
    path.join(__dirname, '..', 'pb_hooks', 'groups.pb.js'),
    'utf8'
);

function rankingHookContext({ route = true } = {}) {
    const track = {
        format: 2,
        points: [
            [0, 0, 100, 1_800_000_000_000],
            [0, 0.001, 110, 1_800_000_100_000],
            [0, 0.002, 120, 1_800_000_200_000]
        ]
    };
    const routeRecord = route ? {
        id: 'synced-route',
        getString(name) {
            return ({
                track: 'track.json',
                kind: 'recorded',
                created: '2026-11-16T12:00:00.000Z'
            })[name] || '';
        },
        baseFilesPath() { return 'routes/synced-route'; }
    } : null;
    const savedEntries = [];
    const queries = [];
    let response;
    const bytes = Buffer.from(JSON.stringify(track), 'utf8');
    let offset = 0;
    const app = {
        findRecordById(collection, id) {
            assert.equal(collection, 'users');
            assert.equal(id, 'user-1');
            return { id, getString: name => name === 'groupCode' ? 'group-1' : '' };
        },
        findRecordsByFilter(collection, filter, _sort, _limit, _offset, params = {}) {
            queries.push({ collection, filter, params });
            if (collection === 'mtb_group_members') return [{ id: 'membership-1' }];
            if (collection === 'routes') return routeRecord ? [routeRecord] : [];
            if (collection === 'mtb_group_ranking_entries') return [];
            throw new Error(`Unexpected collection: ${collection}`);
        },
        findCollectionByNameOrId(name) { return name; },
        save(record) {
            record.id = 'ranking-entry';
            savedEntries.push(record);
        },
        newFilesystem() {
            return {
                getReader(fileKey) {
                    assert.equal(fileKey, 'routes/synced-route/track.json');
                    return {
                        size() { return bytes.length; },
                        read(buffer) {
                            const count = Math.min(buffer.length, bytes.length - offset);
                            for (let index = 0; index < count; index++) buffer[index] = bytes[offset + index];
                            offset += count;
                            return count;
                        },
                        close() {}
                    };
                },
                close() {}
            };
        }
    };
    const utils = {
        ...groupUtils,
        safeMembership(_groupId, userId) {
            return userId === 'user-1' ? [{ id: 'membership-1' }] : [];
        },
        findAllRecordsByFilter(collection, filter, sort) {
            return app.findRecordsByFilter(collection, filter, sort, 200, 0);
        }
    };
    const routes = new Map();
    const context = vm.createContext({
        $app: app,
        $apis: { requireAuth() { return () => {}; } },
        $filepath: { join(...parts) { return parts.join('/'); } },
        __hooks: 'hooks',
        DynamicModel: class {
            constructor(shape) { Object.assign(this, shape); }
        },
        Record: class {
            constructor(collection) { this.collection = collection; this.values = {}; }
            set(name, value) { this.values[name] = value; }
            getString(name) { return String(this.values[name] ?? ''); }
            getFloat(name) { return Number(this.values[name]) || 0; }
        },
        require() { return utils; },
        routerAdd(_method, routePath, handler) { routes.set(routePath, handler); }
    });
    vm.runInContext(hookSource, context, { filename: 'groups.pb.js' });

    return {
        handler: routes.get('/api/mtb/groups/rankings/share'),
        queries,
        savedEntries,
        get response() { return response; },
        async invoke(payload) {
            response = null;
            const result = await this.handler({
                auth: { id: 'user-1' },
                bindBody(body) { Object.assign(body, payload); },
                json(status, body) {
                    response = { status, body };
                    return response;
                }
            });
            return result;
        }
    };
}

test('group ranking share ignores client metrics and stores values recalculated from the owned route track', async () => {
    const context = rankingHookContext();

    const result = await context.invoke({
        clientId: 123,
        distanceKm: 999,
        movingTimeSec: 40000,
        maxSpeedKmh: 150,
        elevationGain: 10000
    });

    assert.equal(result.status, 200);
    const routeQuery = context.queries.find(query => query.collection === 'routes');
    assert.equal(routeQuery.params.owner, 'user-1');
    assert.equal(routeQuery.params.clientId, 123);
    const entry = context.savedEntries[0];
    assert.ok(entry.values.distanceKm > 0.22 && entry.values.distanceKm < 0.23);
    assert.equal(entry.values.movingTimeSec, 200);
    assert.ok(entry.values.maxSpeedKmh > 3.9 && entry.values.maxSpeedKmh < 4.1);
    assert.equal(entry.values.elevationGain, 10);
    assert.equal(entry.values.route, 'synced-route');
    assert.equal(entry.values.routeSyncedAt, '2026-11-16T12:00:00.000Z');
});

test('group ranking share refuses client ids without an owned synchronized route', async () => {
    const context = rankingHookContext({ route: false });

    const result = await context.invoke({ clientId: 456 });

    assert.equal(result.status, 404);
    assert.match(result.body.message, /Sincroniza primero/);
    assert.equal(context.savedEntries.length, 0);
});
