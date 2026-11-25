'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadDuplicateErrorHandler() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-routes.js'), 'utf8');
    const start = source.indexOf('function communityIsDuplicateError');
    const end = source.indexOf('async function submitCommunityRoute');
    const context = vm.createContext({});
    vm.runInContext(source.slice(start, end), context);
    return context;
}

test('the server duplicate rejection is recognised', () => {
    const context = loadDuplicateErrorHandler();
    assert.equal(context.communityIsDuplicateError({ status: 400, message: 'Esta ruta ya está publicada en la comunidad.' }), true);
    assert.equal(context.communityIsDuplicateError({ status: 400, message: 'Otro error' }), false);
});
