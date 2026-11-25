'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const navigationSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'navigation.js'), 'utf8');
const backButtonSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'back-button.js'), 'utf8');
const toolsSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'tools.js'), 'utf8');

function navigationContext(offsets, widths) {
    const wrapperLeft = 244;
    const elements = new Map();
    const queryResults = new Map();
    const queryOneResults = new Map();
    const navButtons = [5, 3, 0, 2, 1, 4].map(page => ({
        dataset: { page: String(page) },
        classList: { toggle() {} }
    }));
    const swiper = {
        getBoundingClientRect: () => ({ left: wrapperLeft }),
        children: offsets.map((offsetLeft, index) => ({
            offsetLeft: offsetLeft + wrapperLeft,
            getBoundingClientRect: () => ({ left: wrapperLeft + offsetLeft, width: widths[index] })
        })),
        style: {}
    };
    const context = vm.createContext({
        $: selector => elements.get(selector) || (selector === 'swiper' ? swiper : null),
        document: {
            addEventListener() {},
            querySelectorAll(selector) {
                return selector === '.nav-btn' ? navButtons : (queryResults.get(selector) || []);
            },
            querySelector(selector) { return queryOneResults.get(selector) || null; },
            getElementById(id) { return elements.get(id) || null; },
            documentElement: { clientWidth: widths[0] },
            body: { dataset: {} }
        },
        map: null,
        statsNeedsRefresh: false,
        requestAnimationFrame(callback) { callback(); },
        ResizeObserver: undefined,
        toolsCloseWorkspaces() { context.closedToolWorkspaces += 1; },
        closedToolWorkspaces: 0,
        toolsHandleBackButton() {
            context.toolsBackCalls += 1;
            if (!context.closeToolsWorkspaceOnBack) return false;
            context.toolsCloseWorkspaces();
            return true;
        },
        toolsBackCalls: 0,
        closeToolsWorkspaceOnBack: false,
        exitPromptCalls: 0,
        isRecording: false,
        window: {
            addEventListener() {},
            innerWidth: widths[0],
            mtbRequestAppExit() { context.exitPromptCalls += 1; }
        },
        console: { error() {}, warn() {} }
    });
    vm.runInContext(navigationSource, context);
    return { context, swiper, elements, queryResults, queryOneResults };
}

function requestExitContext({ recording = true, confirmed = true, saveDraft = async () => true } = {}) {
    const calls = [];
    const toasts = [];
    const start = backButtonSource.indexOf('let exitPromptOpen = false;');
    const end = backButtonSource.indexOf('\nwindow.mtbRequestAppExit = requestAppExit;', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const context = vm.createContext({
        isRecording: recording,
        async modal() {
            calls.push('confirm');
            return confirmed;
        },
        saveDraft() {
            calls.push('save');
            return saveDraft();
        },
        window: {
            MTBNativeApp: {
                async exitApp() { calls.push('exit'); }
            }
        },
        toast: message => toasts.push(message),
        console: { warn() {} }
    });
    vm.runInContext(
        `${backButtonSource.slice(start, end)}\nglobalThis.requestAppExit = requestAppExit;`,
        context
    );
    return { context, calls, toasts };
}

test('exiting during a recording waits for the draft write before native exit', async () => {
    let resolveSave;
    const { context, calls } = requestExitContext({
        saveDraft: () => new Promise(resolve => { resolveSave = resolve; })
    });

    const exiting = context.requestAppExit();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['confirm', 'save']);

    resolveSave(true);
    await exiting;
    assert.deepEqual(calls, ['confirm', 'save', 'exit']);
});

test('exiting during a recording stays open if saving the draft fails', async () => {
    for (const saveDraft of [async () => false, async () => { throw new Error('storage failed'); }]) {
        const { context, calls, toasts } = requestExitContext({ saveDraft });

        await context.requestAppExit();

        assert.deepEqual(calls, ['confirm', 'save']);
        assert.match(toasts[toasts.length - 1], /seguirá abierta/);
    }
});

test('exiting while idle does not attempt to save a recording draft', async () => {
    const { context, calls } = requestExitContext({ recording: false });

    await context.requestAppExit();

    assert.deepEqual(calls, ['confirm', 'exit']);
});

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

test('hardware back closes an open control-center workspace before leaving tools', () => {
    const { context } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(7);
    context.closeToolsWorkspaceOnBack = true;

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(vm.runInContext('currentPage', context), 7);
    assert.equal(context.closedToolWorkspaces, 1);
});

test('hardware back requests exit confirmation at home, including during recording', () => {
    const { context } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(5);
    context.isRecording = true;
    context.handleAppBack = () => false;

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(context.exitPromptCalls, 1);
});

test('hardware back follows the visible main-tab order from profile to home', () => {
    const { context } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(4);
    const expectedPages = [1, 2, 0, 3, 5];

    for (const page of expectedPages) {
        assert.equal(context.window.mtbHandleHardwareBack(), true);
        assert.equal(vm.runInContext('currentPage', context), page);
    }
    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(context.exitPromptCalls, 1);
});

test('native hardware back closes a route detail before changing the page behind it', () => {
    const { context } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(3);
    let detailClosed = 0;
    context.handleCommunityBackButton = () => {
        detailClosed++;
        return true;
    };
    context.$ = id => {
        if (id === 'screen-dim-overlay') return { hidden: true };
        if (id === 'modal') return { classList: { contains: () => false } };
        return null;
    };
    vm.runInContext(backButtonSource, context);

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(detailClosed, 1);
    assert.equal(vm.runInContext('currentPage', context), 3);
});

test('hardware back closes a native dialog before its control-center workspace', () => {
    const { context, queryResults } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(7);
    context.closeToolsWorkspaceOnBack = true;
    const dialog = {
        open: true,
        getClientRects: () => [{}],
        close() { this.open = false; }
    };
    queryResults.set('dialog[open]', [dialog]);
    vm.runInContext(backButtonSource, context);

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(dialog.open, false);
    assert.equal(context.toolsBackCalls, 0);
    assert.equal(vm.runInContext('currentPage', context), 7);
});

test('hardware back closes an expanded inline editor before leaving its page', () => {
    const { context, elements, queryResults } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(4);
    const editor = { hidden: false, getClientRects: () => [{}] };
    const button = {
        getClientRects: () => [{}],
        getAttribute: name => name === 'aria-controls' ? 'profile-editor' : null,
        setAttribute(name, value) { this[name] = value; }
    };
    elements.set('profile-editor', editor);
    queryResults.set('[aria-expanded="true"][aria-controls]', [button]);
    vm.runInContext(backButtonSource, context);

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(editor.hidden, true);
    assert.equal(button['aria-expanded'], 'false');
    assert.equal(vm.runInContext('currentPage', context), 4);
});

test('hardware back closes an open disclosure before leaving its page', () => {
    const { context, queryResults } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(2);
    const disclosure = {
        open: true,
        getClientRects: () => [{}]
    };
    queryResults.set('details[open]', [disclosure]);
    vm.runInContext(backButtonSource, context);

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(disclosure.open, false);
    assert.equal(vm.runInContext('currentPage', context), 2);
});

test('hardware back ignores disclosures on pages behind the current page', () => {
    const { context, swiper, queryResults } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(0);
    let disclosureClosed = false;
    const disclosure = {
        open: true,
        getClientRects: () => [{}],
        closest: () => swiper.children[3]
    };
    Object.defineProperty(disclosure, 'open', {
        get() { return !disclosureClosed; },
        set(value) { disclosureClosed = !value; }
    });
    queryResults.set('details[open]', [disclosure]);
    vm.runInContext(backButtonSource, context);

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(disclosureClosed, false);
    assert.equal(vm.runInContext('currentPage', context), 3);
});

test('hardware back closes an enlarged map metric before changing tabs', () => {
    const { context, elements } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(0);
    let metricCollapsed = false;
    elements.set('big-metric', { classList: { contains: name => name === 'show' } });
    context.collapseMetric = () => { metricCollapsed = true; };
    vm.runInContext(backButtonSource, context);

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(metricCollapsed, true);
    assert.equal(vm.runInContext('currentPage', context), 0);
});

test('hardware back closes an open map popup before changing tabs', () => {
    const { context, swiper } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(0);
    let popupClosed = false;
    const mapPage = swiper.children[0];
    context.map = {
        getContainer() {
            return {
                closest: () => mapPage,
                querySelector: selector => selector === '.leaflet-popup' ? {} : null
            };
        },
        closePopup() { popupClosed = true; }
    };
    vm.runInContext(backButtonSource, context);

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(popupClosed, true);
    assert.equal(vm.runInContext('currentPage', context), 0);
});

test('hardware back returns from a community section to its default section', () => {
    const { context, queryOneResults } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(2);
    let selectedSection = 'segments';
    queryOneResults.set('[data-community-section][aria-selected="true"]', {
        dataset: { communitySection: selectedSection }
    });
    context.communitySetSection = section => { selectedSection = section; };
    vm.runInContext(backButtonSource, context);

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(selectedSection, 'ranking');
    assert.equal(vm.runInContext('currentPage', context), 2);
});

test('hardware back moves to the previous statistics slide before changing tabs', () => {
    const { context } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(1);
    context.activeStatsSlide = 2;
    context.setStatsSlide = index => { context.activeStatsSlide = index; };
    vm.runInContext(backButtonSource, context);

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(context.activeStatsSlide, 1);
    assert.equal(vm.runInContext('currentPage', context), 1);
});

test('hardware back dismisses an open modal instead of requesting app exit', () => {
    const { context, elements } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(0);
    let cancelClicked = false;
    elements.set('modal', { classList: { contains: () => true } });
    elements.set('modal-cancel', { click() { cancelClicked = true; } });

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(cancelClicked, true);
    assert.equal(context.exitPromptCalls, 0);
});

test('hardware back closes the enlarged avatar before navigating away', () => {
    const { context, elements } = navigationContext([0, 390, 780, 1170, 1560, 1950, 2340, 2730],
        [390, 390, 390, 390, 390, 390, 390, 390]);
    context.goToPage(5);
    const avatarDialog = { open: true, close() { this.open = false; } };
    elements.set('home-avatar-dialog', avatarDialog);

    assert.equal(context.window.mtbHandleHardwareBack(), true);
    assert.equal(avatarDialog.open, false);
    assert.equal(vm.runInContext('currentPage', context), 5);
});

test('closing tool workspaces restores the hub and closes the calendar dialog', () => {
    class FakeElement {
        constructor(hidden = true) {
            this.hidden = hidden;
            this.open = true;
        }

        addEventListener() {}
        close() { this.open = false; }
        scrollTo() {}
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
        ['maps-workspace', new FakeElement(false)],
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

    assert.equal(context.toolsHandleBackButton(), true);

    assert.equal(elements.get('.tools-hub').hidden, false);
    assert.equal(elements.get('.tools-page-heading').hidden, false);
    assert.equal(elements.get('safety-workspace').hidden, true);
    assert.equal(elements.get('garage-workspace').hidden, true);
    assert.equal(elements.get('calendar-workspace').hidden, true);
    assert.equal(elements.get('recording-settings-workspace').hidden, true);
    assert.equal(elements.get('sensors-workspace').hidden, true);
    assert.equal(elements.get('maps-workspace').hidden, true);
    assert.equal(elements.get('misc-settings-workspace').hidden, true);
    assert.equal(elements.get('calendar-create-dialog').open, false);
    assert.equal(context.toolsHandleBackButton(), false);
});

test('opening a control-center workspace hides the hub and shows only the chosen panel', () => {
    class FakeElement {
        constructor(hidden = false) {
            this.hidden = hidden;
            this.scrollCalls = [];
        }
        addEventListener() {}
        scrollTo(options) { this.scrollCalls.push(options); }
    }

    const workspaceIds = [
        'safety-workspace', 'garage-workspace', 'calendar-workspace',
        'recording-settings-workspace', 'sensors-workspace',
        'maps-workspace',
        'misc-settings-workspace'
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
    const [scrollCall] = elements.get('.tools-page').scrollCalls;
    assert.equal(scrollCall.top, 0);
    assert.equal(scrollCall.behavior, 'auto');
});
