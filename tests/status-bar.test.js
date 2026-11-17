'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('Android status bar icons stay light over the black strip', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(config.plugins?.SystemBars?.style, 'DARK');
});

test('a black strip covers the status bar and the map starts below it', () => {
    const css = fs.readFileSync(path.join(root, 'app', 'dashboard.css'), 'utf8');
    const strip = css.match(/body::before\s*\{([^}]*)\}/);
    assert.ok(strip, 'falta la franja body::before');
    assert.match(strip[1], /position:\s*fixed/);
    assert.match(strip[1], /height:\s*var\(--app-safe-top\)/);
    assert.match(strip[1], /background:\s*#000/);
    assert.match(strip[1], /pointer-events:\s*none/);
    assert.match(css, /#page-map #map\s*\{\s*top:\s*var\(--app-safe-top\)/);
    assert.match(css, /\.page:not\(#page-map\):not\(#page-home\)\s*\{\s*border-top:\s*var\(--app-safe-top\) solid transparent/);
});
