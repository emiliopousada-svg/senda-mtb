'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function accountProfileContext() {
    const inputs = {
        'acc-profile-weight': { value: '' },
        'acc-profile-age': { value: '' }
    };
    const context = vm.createContext({
        Cloud: { uid: 'user-1' },
        document: { activeElement: null },
        $: id => inputs[id] || null,
        statsApplyAccountProfile() {}
    });
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'app', 'account-avatar.js'), 'utf8'),
        context
    );
    return { context, inputs };
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
