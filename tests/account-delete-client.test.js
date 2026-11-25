'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const cloudSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'cloud.js'), 'utf8');
const start = cloudSource.indexOf('function toggleAccountDeleteForm(');
const end = cloudSource.indexOf('function initSettings(', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const deleteAccountSource = cloudSource.slice(start, end);

function accountDeleteContext(cloudApi) {
    const elements = new Map();
    const localRoutes = [{ id: 1, name: 'Private ride' }];
    for (const id of ['acc-delete-form', 'acc-delete-toggle', 'acc-delete-password', 'acc-delete-status', 'acc-delete-submit']) {
        elements.set(id, {
            hidden: id === 'acc-delete-form',
            value: id === 'acc-delete-password' ? 'current password' : '',
            disabled: false,
            textContent: '',
            attributes: {},
            setAttribute(name, value) { this.attributes[name] = value; },
            focus() {}
        });
    }
    const cloud = {
        active: true,
        server: 'https://server.example',
        uid: 'user-1',
        authGeneration: 1,
        serverSwitchInFlight: false,
        logoutInProgress: false,
        loggedIn() { return this.active; },
        async clearSession() {
            this.active = false;
            this.authGeneration++;
        }
    };
    const calls = [];
    const context = vm.createContext({
        Cloud: cloud,
        navigator: { onLine: true },
        confirm: () => true,
        cloudApi: async (...args) => {
            calls.push(args);
            return cloudApi(...args);
        },
        $: id => elements.get(id),
        toast() {},
        stopGroup: async () => {},
        renderFriends() {},
        renderAccount() {},
        console: { error() {}, warn() {} },
        localRoutes,
        manualAccountSyncInFlight: false,
        accAuthInFlight: false,
        logoutInFlight: false,
        accountDeleteInFlight: false
    });
    vm.runInContext(deleteAccountSource, context);
    return { context, cloud, calls, elements, localRoutes };
}

test('account deletion sends the password, clears the session, and keeps local routes', async () => {
    const { context, cloud, calls, elements, localRoutes } = accountDeleteContext(async () => ({ ok: true }));
    let prevented = false;

    await context.deleteCloudAccount({ preventDefault() { prevented = true; } });

    assert.equal(prevented, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/api/mtb/account/delete');
    assert.equal(calls[0][1], 'POST');
    assert.equal(calls[0][2].password, 'current password');
    assert.equal(cloud.active, false);
    assert.deepEqual(localRoutes, [{ id: 1, name: 'Private ride' }]);
    assert.equal(elements.get('acc-delete-form').hidden, true);
});

test('a server refusal keeps the session and displays its message', async () => {
    const { context, cloud, elements } = accountDeleteContext(async () => {
        throw Object.assign(new Error('Transfiere la administración primero.'), { status: 409 });
    });

    await context.deleteCloudAccount({ preventDefault() {} });

    assert.equal(cloud.active, true);
    assert.equal(elements.get('acc-delete-status').textContent, 'Transfiere la administración primero.');
    assert.equal(elements.get('acc-delete-password').value, '');
    assert.equal(elements.get('acc-delete-submit').disabled, false);
});

test('opening and closing the delete form updates its accessible state and clears the password', () => {
    const { context, elements } = accountDeleteContext(async () => ({ ok: true }));
    const form = elements.get('acc-delete-form');
    const toggle = elements.get('acc-delete-toggle');
    const password = elements.get('acc-delete-password');

    context.toggleAccountDeleteForm(true);
    assert.equal(form.hidden, false);
    assert.equal(toggle.attributes['aria-expanded'], 'true');
    assert.equal(password.value, '');

    password.value = 'temporary';
    context.toggleAccountDeleteForm(false);
    assert.equal(form.hidden, true);
    assert.equal(toggle.attributes['aria-expanded'], 'false');
    assert.equal(password.value, '');
});
