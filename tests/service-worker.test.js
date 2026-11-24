'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function serviceWorkerPolicy() {
    const self = {
        registration: { scope: 'https://example.test/mtb/' },
        addEventListener() {}
    };
    const context = {
        self,
        URL,
        Headers,
        Response,
        fetch: async () => new Response('ok'),
        caches: {}
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), context);
    return vm.runInContext('({ isAppRequest, isCacheableResponse })', context);
}

function request(overrides = {}) {
    return {
        method: 'GET',
        cache: 'default',
        mode: 'cors',
        headers: new Headers(),
        ...overrides
    };
}

test('service worker handles only app shell routes and safe navigations', () => {
    const policy = serviceWorkerPolicy();
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/app/gps.js')), true);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/app/route-photos.js')), true);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/lib/fit.js')), true);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/data.json')), false);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/index.html?token=secret')), false);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/api/routes')), false);
    assert.equal(policy.isAppRequest(request(), new URL('https://example.test/mtb/auth/login')), false);
    assert.equal(policy.isAppRequest(request({ cache: 'no-store' }), new URL('https://example.test/mtb/index.html')), false);
    assert.equal(policy.isAppRequest(request({ mode: 'navigate' }), new URL('https://example.test/mtb/')), true);
    assert.equal(policy.isAppRequest(request({ mode: 'navigate' }), new URL('https://example.test/mtb/api/')), false);
});

test('service worker does not cache private, no-store, or vary-star responses', () => {
    const policy = serviceWorkerPolicy();
    assert.equal(policy.isCacheableResponse(new Response('ok')), true);
    assert.equal(policy.isCacheableResponse(new Response('private', {
        headers: { 'Cache-Control': 'private' }
    })), false);
    assert.equal(policy.isCacheableResponse(new Response('no store', {
        headers: { 'Cache-Control': 'no-store' }
    })), false);
    assert.equal(policy.isCacheableResponse(new Response('vary', {
        headers: { Vary: '*' }
    })), false);
});

test('failed service worker install deletes only its new cache and keeps the active shell', async () => {
    const handlers = new Map();
    const cacheNames = new Set(['mtbpro-shell-v0.2.25-v15']);
    let installedShell = '';
    const self = {
        registration: { scope: 'https://example.test/mtb/' },
        addEventListener: (type, handler) => handlers.set(type, handler),
        skipWaiting: async () => {}
    };
    const context = {
        self,
        URL,
        Headers,
        Response,
        fetch: async url => url === 'index.html'
            ? new Response('missing', { status: 404 })
            : new Response('ok'),
        caches: {
            async open(name) {
                installedShell = name;
                cacheNames.add(name);
                return { async put() {} };
            },
            async delete(name) { return cacheNames.delete(name); }
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), context);

    let installPromise;
    handlers.get('install')({ waitUntil: promise => { installPromise = promise; } });
    await assert.rejects(installPromise);
    assert.equal(cacheNames.has('mtbpro-shell-v0.2.25-v15'), true);
    assert.equal(cacheNames.has(installedShell), false);
});

test('service worker precaches every local script and stylesheet loaded by index.html', () => {
    const root = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const shellUrls = new Set([...sw.matchAll(/^\s*'([^']+)',?$/gm)].map(match => match[1]));
    const localAssets = [
        ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi),
        ...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/gi)
    ].map(match => match[1]).filter(asset => !/^https?:\/\//i.test(asset));
    const missing = localAssets.filter(asset => !shellUrls.has(asset));
    assert.deepEqual(missing, [], `Faltan en SHELL_URLS de sw.js: ${missing.join(', ')}`);
});

test('the CSP blocks inline and CDN scripts while keeping libraries local', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const policy = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
    assert.ok(policy, 'index.html must declare a Content Security Policy');
    assert.match(policy[1], /(?:^|;)\s*script-src 'self'(?:;|$)/);
    assert.doesNotMatch(policy[1], /script-src[^;]*unsafe-inline/i);
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["']https?:\/\//i);
    assert.doesNotMatch(html, /\son(?:click|load|error|submit|change|input)\s*=/i);
    assert.match(html, /src="lib\/maplibre-gl\.js"/);
    assert.match(html, /href="lib\/maplibre-gl\.css"/);
});

test('manifest icons exist with the declared sizes', () => {
    const root = path.join(__dirname, '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
    for (const icon of manifest.icons.filter(item => item.type === 'image/png')) {
        const file = fs.readFileSync(path.join(root, icon.src));
        const width = file.readUInt32BE(16);
        const height = file.readUInt32BE(20);
        assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} no mide ${icon.sizes}`);
    }
});
