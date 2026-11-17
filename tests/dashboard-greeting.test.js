'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function greetingContext(extra = {}) {
    const elements = { 'home-greeting': { textContent: '' } };
    const storage = new Map([['mtb_pro_nickname', 'Rider']]);
    const context = vm.createContext({
        $: id => elements[id] || null,
        localStorage: { getItem: key => storage.has(key) ? storage.get(key) : null },
        ...extra
    });
    const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard.js'), 'utf8');
    const start = source.indexOf('function dashboardUpdateGreeting');
    const end = source.indexOf('function dashboardUpdateNav');
    vm.runInContext(source.slice(start, end), context);
    return { context, elements };
}

test('the home greeting works before cloud.js has defined Cloud', () => {
    const { context, elements } = greetingContext();
    assert.doesNotThrow(() => context.dashboardUpdateGreeting());
    assert.equal(elements['home-greeting'].textContent, '¡Hola, Rider!');
});

test('the home greeting uses the signed-in nickname once Cloud exists', () => {
    const { context, elements } = greetingContext({ Cloud: { nickname: 'Emilio' } });
    context.dashboardUpdateGreeting();
    assert.equal(elements['home-greeting'].textContent, '¡Hola, Emilio!');
});

test('the account avatar lookup works before cloud.js has defined Cloud', () => {
    const storage = new Map([['mtb_pro_uid', 'user1'], ['mtb_pro_avatar_user1', 'data:image/jpeg;base64,AA']]);
    const context = vm.createContext({ localStorage: { getItem: key => storage.has(key) ? storage.get(key) : null } });
    const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'account-avatar.js'), 'utf8');
    vm.runInContext(source.slice(0, source.indexOf('function renderAccountAvatar')), context);
    assert.equal(context.getAccountAvatarUrl(), 'data:image/jpeg;base64,AA');
});
