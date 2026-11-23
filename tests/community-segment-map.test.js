'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'community-routes.js'), 'utf8');
const start = source.indexOf('function openCommunitySegmentMap(segment) {');
const end = source.indexOf('\nfunction communityDistance', start);
const previewFunction = source.slice(start, end);

function mapContext() {
    const elements = new Map();
    const makeElement = () => ({
        hidden: true,
        textContent: '',
        classList: { add() {}, remove() {} }
    });
    [
        'community-detail', 'community-publish', 'community-segment-map-view',
        'community-title', 'community-segment-map-status', 'community-dialog'
    ].forEach(id => elements.set(id, makeElement()));

    const state = { mapIds: [], lines: [], errors: [] };
    const map = {
        removeLayer() {},
        invalidateSize() {},
        fitBounds() {}
    };
    const context = vm.createContext({
        $: id => elements.get(id),
        communityRecordLines: segment => segment.trackJson,
        communityCancelSegmentCreation() {},
        toast(message) { state.errors.push(message); },
        setTimeout(callback) { callback(); },
        L: {
            map(id) { state.mapIds.push(id); return map; },
            polyline(lines) {
                state.lines.push(lines);
                return {
                    addTo() { return this; },
                    getBounds() { return { isValid: () => true }; }
                };
            }
        },
        selectedMapStyle: () => 'topographic',
        createMapStyleLayers: () => ({ topographic: { addTo() {} } }),
        createOfflineTileLayer: () => ({ addTo() {} }),
        navigator: { onLine: true },
        console: { warn(_message, error) { state.errors.push(error); } }
    });
    vm.runInContext(`
        let communitySegmentPreviewMap = null;
        let communitySegmentPreviewBaseLayer = null;
        let communitySegmentPreviewLayer = null;
        ${previewFunction}
        globalThis.openCommunitySegmentMap = openCommunitySegmentMap;
    `, context);
    return { context, elements, state };
}

test('segment map renders only the selected segment geometry', () => {
    const { context, elements, state } = mapContext();
    const geometry = [[41.1, -8.6], [41.2, -8.5]];

    context.openCommunitySegmentMap({ title: 'Subida', trackJson: geometry });

    assert.deepEqual(state.mapIds, ['community-segment-map']);
    assert.deepEqual(state.lines, [geometry]);
    assert.equal(elements.get('community-segment-map-view').hidden, false);
    assert.match(elements.get('community-segment-map-status').textContent, /únicamente el trazado de este segmento/);
});

test('segment map rejects invalid geometry instead of showing a route map', () => {
    const { context, elements, state } = mapContext();

    context.openCommunitySegmentMap({ title: 'Inválido', trackJson: null });

    assert.deepEqual(state.mapIds, []);
    assert.deepEqual(state.lines, []);
    assert.equal(elements.get('community-dialog').hidden, true);
    assert.equal(state.errors.length, 1);
});
