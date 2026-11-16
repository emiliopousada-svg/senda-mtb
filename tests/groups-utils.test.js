'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { groupRankingSummaryFromEntries } = require('../pb_hooks/groups_utils.js');

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
