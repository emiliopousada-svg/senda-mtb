'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'screen-activity.js'), 'utf8');

function screenContext(oledSaverEnabled) {
    const timers = [];
    const actions = [];
    const makeClassList = initial => {
        const classes = new Set(initial);
        return {
            contains: name => classes.has(name),
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            }
        };
    };
    const overlay = {
        hidden: true,
        classList: makeClassList([]),
        addEventListener() {}
    };
    const context = vm.createContext({
        document: {
            visibilityState: 'visible',
            body: { classList: makeClassList(oledSaverEnabled ? ['cockpit-oled-saver'] : []) },
            addEventListener() {}
        },
        navigator: {},
        window: {
            Capacitor: {
                isNativePlatform: () => true,
                Plugins: {
                    ScreenControl: {
                        dim: () => { actions.push('dim'); return Promise.resolve(); },
                        wake: () => { actions.push('wake'); return Promise.resolve(); }
                    }
                }
            },
            addEventListener() {}
        },
        $: () => overlay,
        setTimeout(callback, delay) {
            timers.push({ callback, delay });
            return timers.length;
        },
        clearTimeout() {},
        toast() {},
        console: { warn() {} }
    });
    vm.runInContext(source, context);
    return { context, timers, actions, overlay };
}

test('OLED saver dims after a short idle period and wakes briefly for navigation cues', () => {
    const { context, timers, actions, overlay } = screenContext(true);
    assert.equal(timers[0].delay, 20_000);

    context.screenSetDimmed(true);
    context.screenWakeForNavigation();

    assert.deepEqual(actions, ['dim', 'wake']);
    assert.equal(overlay.hidden, true);
    assert.equal(timers[timers.length - 1].delay, 20_000);
});

test('normal screen timing remains unchanged and navigation cues do not wake it', () => {
    const { context, timers, actions, overlay } = screenContext(false);
    assert.equal(timers[0].delay, 5 * 60 * 1000);

    context.screenSetDimmed(true);
    context.screenWakeForNavigation();

    assert.deepEqual(actions, ['dim']);
    assert.equal(overlay.hidden, false);
    assert.equal(timers.length, 1);
});
