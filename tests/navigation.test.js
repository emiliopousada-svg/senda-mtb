'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const navigationSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'navigation.js'), 'utf8');
const toolsSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'tools.js'), 'utf8');

function navigationContext(offsets, widths) {
    const wrapperLeft = 244;
    const swiper = {
        getBoundingClientRect: () => ({ left: wrapperLeft }),
        children: offsets.map((offsetLeft, index) => ({
            offsetLeft: offsetLeft + wrapperLeft,
            getBoundingClientRect: () => ({ left: wrapperLeft + offsetLeft, width: widths[index] })
        })),
        style: {}
    };
    const context = vm.createContext({
        $: () => swiper,
        document: {
            addEventListener() {},
            querySelectorAll() { return []; },
            documentElement: { clientWidth: widths[0] },
            body: { dataset: {} }
        },
        window: {
            addEventListener() {},
            innerWidth: widths[0]
        },
        statsNeedsRefresh: false,
        requestAnimationFrame(callback) { callback(); },
        ResizeObserver: undefined,
        toolsCloseWorkspaces() { context.closedToolWorkspaces += 1; },
        closedToolWorkspaces: 0,
        console: { error() {}, warn() {} }
    });
    vm.runInContext(navigationSource, context);
    return { context, swiper };
}

test('page navigation translates to each page actual offset', () => {
    const offsets = [0, 390, 780, 1170, 1560, 1950, 2340];
    const widths = [390, 390, 412, 390, 428, 390, 390];
    const { context, swiper } = navigationContext(offsets, widths);

    offsets.forEach((offset, index) => {
        context.setSwiperPosition(index);
        assert.equal(swiper.style.transform, `translate3d(-${offset}px,0,0)`);
    });
});

test('swiping from home follows the first route in carousel order', () => {
    const { context } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);

    context.goToAdjacentPage(1);
    assert.equal(vm.runInContext('currentPage', context), 3);

    context.goToAdjacentPage(-1);
    assert.equal(vm.runInContext('currentPage', context), 5);
});

test('navigating away from tools closes its nested workspaces', () => {
    const { context } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);

    context.goToPage(7);
    assert.equal(context.closedToolWorkspaces, 0);
    context.goToPage(3);
    assert.equal(context.closedToolWorkspaces, 1);
});

test('closing tool workspaces restores the hub and closes the calendar dialog', () => {
    class FakeElement {
        constructor(hidden = true) {
            this.hidden = hidden;
            this.open = true;
        }

        addEventListener() {}
        close() { this.open = false; }
        scrollIntoView() {}
    }

    const elements = new Map([
        ['.tools-grid', new FakeElement()],
        ['.tools-page', new FakeElement()],
        ['.tools-hub', new FakeElement(true)],
        ['.tools-page-heading', new FakeElement(true)],
        ['safety-workspace', new FakeElement(false)],
        ['garage-workspace', new FakeElement(false)],
        ['calendar-workspace', new FakeElement(false)],
        ['recording-settings-workspace', new FakeElement(false)],
        ['sensors-workspace', new FakeElement(false)],
        ['offline-maps-workspace', new FakeElement(false)],
        ['map-style-workspace', new FakeElement(false)],
        ['misc-settings-workspace', new FakeElement(false)],
        ['calendar-create-dialog', new FakeElement(false)]
    ]);
    const context = vm.createContext({
        document: {
            querySelector: selector => elements.get(selector) || null,
            getElementById: id => elements.get(id) || null
        }
    });
    vm.runInContext(toolsSource, context);

    context.toolsCloseWorkspaces();

    assert.equal(elements.get('.tools-hub').hidden, false);
    assert.equal(elements.get('.tools-page-heading').hidden, false);
    assert.equal(elements.get('safety-workspace').hidden, true);
    assert.equal(elements.get('garage-workspace').hidden, true);
    assert.equal(elements.get('calendar-workspace').hidden, true);
    assert.equal(elements.get('recording-settings-workspace').hidden, true);
    assert.equal(elements.get('sensors-workspace').hidden, true);
    assert.equal(elements.get('offline-maps-workspace').hidden, true);
    assert.equal(elements.get('map-style-workspace').hidden, true);
    assert.equal(elements.get('misc-settings-workspace').hidden, true);
    assert.equal(elements.get('calendar-create-dialog').open, false);
});

test('opening a control-center workspace hides the hub and shows only the chosen panel', () => {
    class FakeElement {
        constructor(hidden = false) { this.hidden = hidden; }
        addEventListener() {}
        scrollIntoView() {}
    }

    const workspaceIds = [
        'safety-workspace', 'garage-workspace', 'calendar-workspace',
        'recording-settings-workspace', 'sensors-workspace',
        'offline-maps-workspace', 'map-style-workspace', 'misc-settings-workspace'
    ];
    const elements = new Map([
        ['.tools-grid', new FakeElement()],
        ['.tools-page', new FakeElement()],
        ['.tools-hub', new FakeElement()],
        ['.tools-page-heading', new FakeElement()],
        ...workspaceIds.map(id => [id, new FakeElement()])
    ]);
    const context = vm.createContext({
        document: {
            querySelector: selector => elements.get(selector) || null,
            getElementById: id => elements.get(id) || null
        },
        console: { error() {} }
    });
    vm.runInContext(toolsSource, context);

    context.toolsOpenWorkspace('sensors-workspace');

    assert.equal(elements.get('.tools-hub').hidden, true);
    assert.equal(elements.get('.tools-page-heading').hidden, true);
    for (const id of workspaceIds) {
        assert.equal(elements.get(id).hidden, id !== 'sensors-workspace');
    }
});
