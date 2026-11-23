'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-routes.js'), 'utf8');
const start = source.indexOf('function handleCommunityBackButton() {');
const end = source.indexOf('\nfunction openCommunityPublish', start);
const handlerSource = source.slice(start, end);

function communityBackContext({
    detailHidden = true,
    publishHidden = true,
    segmentMapHidden = true
} = {}) {
    const elements = new Map([
        ['community-dialog', { hidden: false }],
        ['community-detail', { hidden: detailHidden }],
        ['community-publish', { hidden: publishHidden }],
        ['community-segment-map-view', { hidden: segmentMapHidden }],
        ['community-segment-editor', { hidden: true }]
    ]);
    const state = { catalogOpened: 0, dialogClosed: 0, detailReturned: 0 };
    const context = vm.createContext({
        $: id => elements.get(id),
        communitySegmentSelecting: false,
        communityCancelSegmentCreation() {},
        communityDetailBackAction() { state.detailReturned += 1; },
        openCommunityCatalog() { state.catalogOpened += 1; },
        closeCommunityDialog() { state.dialogClosed += 1; },
        currentPage: 2,
        setRoutesTab() {}
    });
    vm.runInContext(`${handlerSource}\nglobalThis.handleCommunityBackButton = handleCommunityBackButton;`, context);
    return { context, state };
}

test('hardware back returns from the community publish form to its catalog first', () => {
    const { context, state } = communityBackContext({ publishHidden: false });

    assert.equal(context.handleCommunityBackButton(), true);
    assert.equal(state.catalogOpened, 1);
    assert.equal(state.dialogClosed, 0);
});

test('hardware back closes the community segment-map card before leaving its page', () => {
    const { context, state } = communityBackContext({ segmentMapHidden: false });

    assert.equal(context.handleCommunityBackButton(), true);
    assert.equal(state.dialogClosed, 1);
});

test('hardware back returns from a community route detail to its parent list', () => {
    const { context, state } = communityBackContext({ detailHidden: false });

    assert.equal(context.handleCommunityBackButton(), true);
    assert.equal(state.detailReturned, 1);
    assert.equal(state.dialogClosed, 0);
});
