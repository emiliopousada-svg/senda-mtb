'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const validator = path.join(__dirname, '..', 'scripts', 'validate-coderabbit-review.js');

function validate(events) {
    return spawnSync(process.execPath, [validator], {
        encoding: 'utf8',
        input: events.map(event => JSON.stringify(event)).join('\n')
    });
}

test('rejects output without a final complete event', () => {
    const result = validate([{ type: 'finding', severity: 'major' }]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /did not end with a complete event/);
});

test('rejects skipped or failed reviews and unreviewed files', () => {
    for (const completion of [
        { type: 'complete', status: 'review_skipped' },
        { type: 'complete', outcome: 'failed' },
        { type: 'complete', unreviewedFileCount: 2 }
    ]) {
        assert.equal(validate([completion]).status, 1);
    }
});

test('rejects an error event even when followed by a completion event', () => {
    const result = validate([
        { type: 'error', message: 'A review stage failed' },
        { type: 'complete', outcome: 'completed' }
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /error event/);
});

test('allows findings and completed reviews with warnings', () => {
    const result = validate([
        { type: 'finding', severity: 'major', title: 'Example finding' },
        { type: 'complete', outcome: 'completed_with_warnings', unreviewedFileCount: 0 }
    ]);
    assert.equal(result.status, 0, result.stderr);
});

test('allows older completion events that omit outcome fields', () => {
    const result = validate([{ type: 'complete' }]);
    assert.equal(result.status, 0, result.stderr);
});
