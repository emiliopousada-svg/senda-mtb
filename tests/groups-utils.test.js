'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    groupRankingSummaryFromEntries,
    calculateGroupActivityMetrics,
    entryTimeMs,
    findRecordsByIds,
    findAllRecordsByFilter,
    deleteAllRecordsByFilter,
    loadActiveGroupContext
} = require('../pb_hooks/groups_utils.js');

function rankingEntry(owner, created, values) {
    const record = { owner, created, ...values };
    return {
        getString(field) {
            return String(record[field] ?? '');
        },
        getFloat(field) {
            return Number(record[field]) || 0;
        }
    };
}

test('group ranking summary includes only entries within the active season', () => {
    const season = {
        startMs: Date.parse('2026-11-02T00:00:00.000Z'),
        endMs: Date.parse('2026-11-29T23:59:59.999Z')
    };
    const entries = [
        rankingEntry('rider-1', '2026-10-30T12:00:00.000Z', {
            distanceKm: 80, movingTimeSec: 7200, maxSpeedKmh: 50, elevationGain: 1200
        }),
        rankingEntry('rider-1', '2026-11-16T12:00:00.000Z', {
            distanceKm: 25, movingTimeSec: 3600, maxSpeedKmh: 25, elevationGain: 300
        }),
        rankingEntry('rider-1', '2026-12-01T12:00:00.000Z', {
            distanceKm: 100, movingTimeSec: 14400, maxSpeedKmh: 60, elevationGain: 2000
        }),
        rankingEntry('rider-1', 'not-a-date', {
            distanceKm: 120, movingTimeSec: 18000, maxSpeedKmh: 70, elevationGain: 2500
        })
    ];

    const summary = groupRankingSummaryFromEntries(entries, { season });

    assert.deepEqual(summary['rider-1'], {
        maxDistanceKm: 25,
        distanceMovingTimeSec: 3600,
        maxElevationGainM: 300,
        bestMovingTimeSec: 3600,
        maxSpeedKmh: 25,
        activityCount: 1,
        totalDistanceKm: 25,
        totalElevationM: 300,
        leaguePoints: 45
    });
});

test('group ranking activity metrics are recalculated from synchronized track points', () => {
    const metrics = calculateGroupActivityMetrics({
        format: 2,
        points: [
            [0, 0, 100, 1_800_000_000_000],
            [0, 0.001, 110, 1_800_000_100_000],
            [0, 0.002, 120, 1_800_000_200_000]
        ]
    });

    assert.ok(metrics.distanceKm > 0.22 && metrics.distanceKm < 0.23);
    assert.equal(metrics.movingTimeSec, 200);
    assert.ok(metrics.maxSpeedKmh > 3.9 && metrics.maxSpeedKmh < 4.1);
    assert.equal(metrics.elevationGain, 10);
});

test('verified ranking entries use the server-supplied activity date, not the client id', () => {
    const entry = rankingEntry('rider-1', '2026-11-16T12:00:00.000Z', {
        clientId: Date.parse('2026-01-05T00:00:00.000Z'),
        routeSyncedAt: '2026-11-16T12:00:00.000Z'
    });

    assert.equal(entryTimeMs(entry), Date.parse('2026-11-16T12:00:00.000Z'));
});

test('findRecordsByIds deduplicates ids and splits lookups into bounded batches', () => {
    const records = Array.from({ length: 205 }, (_, index) => ({ id: `user-${index}` }));
    const calls = [];
    const app = {
        findRecordsByFilter(collection, filter, sort, limit, offset, params) {
            calls.push({ collection, filter, sort, limit, offset, params });
            const ids = Object.values(params);
            return records.filter(record => ids.includes(record.id));
        }
    };

    const found = findRecordsByIds(app, 'users', [...records.map(record => record.id), 'user-0']);

    assert.equal(found.length, 205);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(call => call.limit), [100, 100, 5]);
    assert.ok(calls.every(call => call.collection === 'users' && call.offset === 0));
    assert.ok(calls.every(call => call.filter.includes('id = {:id0}')));
});

test('findRecordsByIds rejects unsafe ids before querying', () => {
    let queries = 0;
    const app = { findRecordsByFilter() { queries++; return []; } };

    assert.throws(() => findRecordsByIds(app, 'users', ['valid-id', 'bad" || id != ""']), /id inválido/);
    assert.equal(queries, 0);
});

test('findAllRecordsByFilter binds parameters on every paginated query', () => {
    const calls = [];
    const app = {
        findRecordsByFilter(collection, filter, sort, limit, offset, params) {
            calls.push({ collection, filter, sort, limit, offset, params });
            return offset === 0 ? Array.from({ length: 200 }, (_, index) => index) : ['last'];
        }
    };
    const params = { group: 'group-1' };

    const records = findAllRecordsByFilter('mtb_group_members', 'group = {:group}', '', app, params);

    assert.equal(records.length, 201);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.filter === 'group = {:group}' && call.params === params));
    assert.deepEqual(calls.map(call => call.offset), [0, 200]);
});

test('deleteAllRecordsByFilter binds parameters for each delete batch', () => {
    const records = [{ id: 'one' }, { id: 'two' }];
    const calls = [];
    const params = { group: 'group-1' };
    const app = {
        findRecordsByFilter(_collection, filter, _sort, _limit, _offset, queryParams) {
            calls.push({ filter, queryParams });
            return records.slice();
        },
        delete(record) {
            records.splice(records.indexOf(record), 1);
        }
    };

    const deleted = deleteAllRecordsByFilter('live_locations', 'groupCode = {:group}', app, params);

    assert.equal(deleted, 2);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.filter === 'groupCode = {:group}' && call.queryParams === params));
});

test('loadActiveGroupContext batches member profiles into one query', () => {
    const record = (id, values) => ({
        id,
        getString(field) { return String(values[field] ?? ''); }
    });
    const user = record('user-1', { groupCode: 'group-1' });
    const group = record('group-1', { owner: 'user-1' });
    const memberships = [
        record('membership-1', { user: 'user-1', nickname: 'Old Rider' }),
        record('membership-2', { user: 'user-2', nickname: 'Second Rider' })
    ];
    const profiles = [
        record('user-1', { nickname: 'Rider' }),
        record('user-2', { nickname: 'Second' })
    ];
    let profileQueries = 0;
    const app = {
        findRecordById(collection, id) {
            if (collection === 'users' && id === user.id) return user;
            if (collection === 'mtb_groups' && id === group.id) return group;
            throw new Error(`Unexpected record lookup: ${collection}/${id}`);
        },
        findRecordsByFilter(collection, _filter, _sort, _limit, _offset, params = {}) {
            if (collection === 'mtb_group_members' && params.group && params.user) return [memberships[0]];
            if (collection === 'mtb_group_members') return memberships;
            if (collection === 'users') {
                profileQueries++;
                const ids = Object.values(params);
                return profiles.filter(profile => ids.includes(profile.id));
            }
            throw new Error(`Unexpected collection query: ${collection}`);
        }
    };

    const context = loadActiveGroupContext('user-1', app);

    assert.equal(profileQueries, 1);
    assert.deepEqual(context.members, [
        { userId: 'user-1', nickname: 'Rider' },
        { userId: 'user-2', nickname: 'Second' }
    ]);
});
