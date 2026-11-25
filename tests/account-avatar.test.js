'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function accountProfileContext({ pendingValue = null, warnings = [] } = {}) {
    const inputs = {
        'acc-profile-weight': { value: '' },
        'acc-profile-age': { value: '' }
    };
    const appliedLocations = [];
    const context = vm.createContext({
        Cloud: { uid: 'user-1' },
        document: { activeElement: null },
        $: id => inputs[id] || null,
        localStorage: { getItem: () => pendingValue },
        console: { warn(...args) { warnings.push(args); } },
        profileApplyAccountLocation: record => appliedLocations.push(record.homeLocation || ''),
        statsApplyAccountProfile() {}
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'account-avatar.js'), 'utf8'),
        context
    );
    return { context, inputs, appliedLocations };
}

test('account profile treats PocketBase zero defaults as unset', () => {
    const { context, inputs } = accountProfileContext();

    context.renderAccountProfile({ weightKg: 0, age: 0 });
    assert.equal(inputs['acc-profile-weight'].value, '');
    assert.equal(inputs['acc-profile-age'].value, '');

    context.renderAccountProfile({ weightKg: 72.5, age: 34 }, true);
    assert.equal(inputs['acc-profile-weight'].value, '72.5');
    assert.equal(inputs['acc-profile-age'].value, '34');
});

test('account profile applies the saved locality even without performance fields', () => {
    const { context, inputs, appliedLocations } = accountProfileContext();
    context.renderAccountProfile({ homeLocation: 'Ponte Caldelas, Galicia' });
    assert.deepEqual(appliedLocations, ['Ponte Caldelas, Galicia']);
    assert.equal(inputs['acc-profile-weight'].value, '');
    assert.equal(inputs['acc-profile-age'].value, '');
});

test('corrupt pending account profile falls back to server data and reports the read error', () => {
    const warnings = [];
    const { context, inputs } = accountProfileContext({ pendingValue: '{invalid', warnings });

    context.renderAccountProfile({ weightKg: 72, age: 34 });

    assert.equal(inputs['acc-profile-weight'].value, '72');
    assert.equal(inputs['acc-profile-age'].value, '34');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /perfil pendiente/);
});

test('account avatar URL works before cloud.js defines Cloud', () => {
    const storage = {
        mtb_pro_avatar_last_uid: 'user-1',
        'mtb_pro_avatar_user-1': 'data:image/jpeg;base64,avatar'
    };
    const context = vm.createContext({
        document: { activeElement: null },
        $: () => null,
        localStorage: { getItem: key => storage[key] ?? null }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'account-avatar.js'), 'utf8'),
        context
    );
    assert.equal(context.getAccountAvatarUrl(), 'data:image/jpeg;base64,avatar');
});

test('account avatar uses the app icon when no uploaded avatar exists', () => {
    const context = vm.createContext({
        Cloud: { uid: 'user-1' },
        localStorage: { getItem: () => null }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'account-avatar.js'), 'utf8'),
        context
    );

    assert.equal(context.getAccountAvatarUrl(), 'icon-512.png');
    context.Cloud.uid = '';
    assert.equal(context.getAccountAvatarUrl(), 'icon-512.png');
});

test('deleting an account clears its local avatar cache without touching other accounts', () => {
    const storage = new Map([
        ['mtb_pro_avatar_last_uid', 'user-1'],
        ['mtb_pro_avatar_user-1', 'data:image/jpeg;base64,deleted'],
        ['mtb_pro_avatar_remote_user-1', 'avatar.jpg'],
        ['mtb_pro_avatar_pending_user-1', '{"avatar":"pending"}'],
        ['mtb_pro_avatar_user-2', 'data:image/jpeg;base64,other']
    ]);
    const image = { src: '', hidden: false };
    const placeholder = { hidden: true };
    const context = vm.createContext({
        Cloud: { uid: 'user-1' },
        document: { activeElement: null },
        $: id => id === 'acc-avatar-image' ? image : id === 'acc-avatar-placeholder' ? placeholder : null,
        localStorage: {
            getItem(key) { return storage.get(key) || null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'account-avatar.js'), 'utf8'),
        context
    );

    context.clearDeletedAccountAvatar('user-1');

    assert.equal(storage.has('mtb_pro_avatar_last_uid'), false);
    assert.equal(storage.has('mtb_pro_avatar_user-1'), false);
    assert.equal(storage.has('mtb_pro_avatar_remote_user-1'), false);
    assert.equal(storage.has('mtb_pro_avatar_pending_user-1'), false);
    assert.equal(storage.has('mtb_pro_avatar_user-2'), true);
    assert.equal(context.getAccountAvatarUrl(), 'icon-512.png');
});

test('physical profile can still be saved when the avatar editor is absent', async () => {
    const storage = new Map();
    const save = {
        disabled: false,
        addEventListener(type, listener) {
            if (type === 'click') this.onClick = listener;
        }
    };
    const inputs = {
        'acc-profile-save': save,
        'acc-profile-weight': { value: '72' },
        'acc-profile-height': { value: '178' },
        'acc-profile-age': { value: '34' }
    };
    const context = vm.createContext({
        Cloud: { uid: 'user-1' },
        $: id => inputs[id] || null,
        document: { activeElement: null },
        localStorage: {
            getItem(key) { return storage.get(key) || null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        navigator: { onLine: false },
        renderAccountAvatar() {},
        statsApplyAccountProfile() {},
        toast() {},
        console: { warn() {} }
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'account-avatar.js'), 'utf8'),
        context
    );
    context.initAccountAvatar();

    await save.onClick();

    const pending = JSON.parse(storage.get('mtb_pro_avatar_pending_user-1'));
    assert.equal(pending.avatar, '');
    assert.equal(pending.weightKg, '72');
    assert.equal(pending.heightCm, '178');
    assert.equal(pending.age, '34');
    assert.equal(save.disabled, false);
});
