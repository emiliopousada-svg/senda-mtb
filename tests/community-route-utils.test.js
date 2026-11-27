'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    communityRouteBounds,
    communityRouteDistance,
    communityRouteDistanceMeters,
    communityRouteTrimEnds
} = require('../pb_hooks/community_routes_utils.js');

test('community route distance sums within segments without connecting segment gaps', () => {
    const lines = [
        [[0, 0], [0, 0.001]],
        [[10, 10], [10, 10.001]]
    ];
    const expected = communityRouteDistance(lines[0][0], lines[0][1])
        + communityRouteDistance(lines[1][0], lines[1][1]);

    assert.equal(communityRouteDistanceMeters(lines), expected);
});

test('community route trimming interpolates endpoint altitude without mutating its input', () => {
    const lines = [[
        [0, 0, 100],
        [0.001, 0.001, 200],
        [0.5, 0.5, 300]
    ]];

    const trimmed = communityRouteTrimEnds(lines, 150);
    const [line] = trimmed;

    assert.equal(line.length, 3);
    assert.ok(line[0][0] > 0 && line[0][0] < 0.001);
    assert.ok(line[0][2] > 100 && line[0][2] < 200);
    assert.ok(line[2][0] > 0.001 && line[2][0] < 0.5);
    assert.ok(line[2][2] > 200 && line[2][2] < 300);
    assert.deepEqual(lines, [[
        [0, 0, 100],
        [0.001, 0.001, 200],
        [0.5, 0.5, 300]
    ]]);
});

test('community route trimming follows the short arc across the antimeridian', () => {
    const lines = [[[0, 179.99], [0, -179.99]]];
    const originalDistance = communityRouteDistanceMeters(lines);
    const trimmed = communityRouteTrimEnds(lines, 150);
    const [line] = trimmed;

    assert.equal(line.length, 2);
    assert.ok(Math.abs(line[0][1]) > 179.98);
    assert.ok(Math.abs(line[1][1]) > 179.98);
    assert.ok(Math.abs(communityRouteDistanceMeters(trimmed) - (originalDistance - 300)) < 1);
});

test('community route bounds report extents and invalid geometry without PocketBase errors', () => {
    assert.deepEqual(communityRouteBounds([
        [[42, -8], [43, -7]],
        [[41, -9]]
    ]), {
        minLat: 41,
        maxLat: 43,
        minLng: -9,
        maxLng: -7,
        count: 3
    });
    assert.deepEqual(communityRouteBounds([null]), { error: 'invalid-line' });
    assert.deepEqual(communityRouteBounds([[[42]]]), { error: 'invalid-point' });
    assert.deepEqual(communityRouteBounds([[[91, 0]]]), { error: 'out-of-range' });
});
