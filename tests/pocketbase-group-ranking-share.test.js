'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function shareHandler(activeGroupId) {
    let handler;
    const saved = [];
    const ranking = {
        maxDistanceKm: 10,
        distanceMovingTimeSec: 1800,
        maxElevationGainM: 500,
        bestMovingTimeSec: 1800,
        maxSpeedKmh: 30,
        activityCount: 1,
        leaguePoints: 20
    };
    class DynamicModel {
        constructor(fields) { Object.assign(this, fields); }
    }
    class Record {
        constructor() { this.fields = {}; }
        set(name, value) { this.fields[name] = value; }
        getFloat(name) { return Number(this.fields[name]) || 0; }
    }
    const context = vm.createContext({
        DynamicModel,
        Record,
        __hooks: 'hooks',
        $apis: { requireAuth() { return () => {}; } },
        $app: {
            findCollectionByNameOrId() { return 'mtb_group_ranking_entries'; },
            findRecordById() {
                return { id: 'user-1', getString(name) { return name === 'groupCode' ? activeGroupId : ''; } };
            },
            findRecordsByFilter() { return []; },
            save(record) { saved.push(record); }
        },
        require() {
            return {
                requireSafeValue(value) { return String(value || '').trim(); },
                safeMembership() { return [{}]; },
                findAllRecordsByFilter() { return []; },
                groupRankingSummaryFromEntries(entries) {
                    return entries.length ? { 'user-1': ranking } : {};
                }
            };
        },
        routerAdd(method, route, callback) {
            if (method === 'POST' && route === '/api/mtb/groups/rankings/share') handler = callback;
        }
    });
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'pb_hooks', 'groups.pb.js'),
        'utf8'
    );
    const start = source.indexOf('routerAdd("POST", "/api/mtb/groups/rankings/share"');
    const end = source.indexOf('\nrouterAdd(', start + 1);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    vm.runInContext(source.slice(start, end), context);
    assert.equal(typeof handler, 'function');
    return { handler, saved };
}

function request(groupId) {
    return {
        auth: { id: 'user-1' },
        body: { clientId: 7, groupId, distanceKm: 10, movingTimeSec: 1800, maxSpeedKmh: 30, elevationGain: 500 },
        bindBody(model) { Object.assign(model, this.body); },
        json(status, body) { return { status, body }; }
    };
}

test('ranking share rejects a group that is no longer active', () => {
    const { handler, saved } = shareHandler('group-b');

    const result = handler(request('group-a'));

    assert.equal(result.status, 403);
    assert.equal(saved.length, 0);
});

test('ranking share saves into the explicitly confirmed active group', () => {
    const { handler, saved } = shareHandler('group-a');

    const result = handler(request('group-a'));

    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].fields.group, 'group-a');
});
