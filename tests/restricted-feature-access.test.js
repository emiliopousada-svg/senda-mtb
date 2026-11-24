'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const readAppFile = fileName => fs.readFileSync(path.join(__dirname, '..', 'app', fileName), 'utf8');

function loadAppFunction(fileName, functionName, context) {
    const source = readAppFile(fileName);
    const helper = source.match(new RegExp(`function ${functionName}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(helper, `${functionName} is present`);
    vm.runInContext(helper[0], context);
    return context[functionName];
}

function loadRequireSignedIn(isLoggedIn) {
    const cloudSource = readAppFile('cloud.js');
    const helper = cloudSource.match(/function requireSignedIn\(message\) \{[\s\S]*?\n\}/);
    assert.ok(helper, 'requireSignedIn helper is present');

    const calls = [];
    const context = vm.createContext({
        Cloud: { loggedIn: () => isLoggedIn },
        toast: message => calls.push(['toast', message]),
        goToPage: page => calls.push(['page', page])
    });
    vm.runInContext(helper[0], context);
    return { requireSignedIn: context.requireSignedIn, calls };
}

function loadRouteTabHelper(isLoggedIn) {
    const source = readAppFile('routes.js');
    const helper = source.match(/function routeBelongsInRoutesTab\(route, tab\) \{[\s\S]*?\n\}/);
    assert.ok(helper, 'routeBelongsInRoutesTab helper is present');
    const context = vm.createContext({ Cloud: { loggedIn: () => isLoggedIn } });
    vm.runInContext(helper[0], context);
    return context.routeBelongsInRoutesTab;
}

test('shared account gate allows signed-in users and redirects anonymous users', () => {
    const authenticated = loadRequireSignedIn(true);
    assert.equal(authenticated.requireSignedIn('restricted'), true);
    assert.deepEqual(authenticated.calls, []);

    const anonymous = loadRequireSignedIn(false);
    assert.equal(anonymous.requireSignedIn('restricted'), false);
    assert.deepEqual(anonymous.calls, [['toast', 'restricted'], ['page', 4]]);
});

test('offline map download controls follow account state and stop after logout', () => {
    const hasAccount = { value: false };
    const elements = {
        'offline-download-controls': { hidden: true },
        'offline-login-required': { hidden: true },
        'offline-storage-note': { textContent: '' }
    };
    const context = vm.createContext({
        Cloud: { loggedIn: () => hasAccount.value },
        $: id => elements[id],
        offlineDownloadRunning: true,
        stopOfflineDownload: false
    });
    const updateAccess = loadAppFunction('offline-maps.js', 'offlineMapsUpdateAccessState', context);

    updateAccess();
    assert.equal(elements['offline-download-controls'].hidden, true);
    assert.equal(elements['offline-login-required'].hidden, false);
    assert.equal(context.stopOfflineDownload, true);

    hasAccount.value = true;
    context.offlineDownloadRunning = false;
    updateAccess();
    assert.equal(elements['offline-download-controls'].hidden, false);
    assert.equal(elements['offline-login-required'].hidden, true);
});

test('route import controls stay hidden until an account is active', () => {
    const hasAccount = { value: false };
    const elements = {
        'routes-import-box': { hidden: true },
        'routes-import-login': { hidden: true }
    };
    const context = vm.createContext({
        Cloud: { loggedIn: () => hasAccount.value },
        $: id => elements[id],
        routesTab: 'pending'
    });
    const updateAccess = loadAppFunction('routes.js', 'routesUpdateImportAccess', context);

    updateAccess();
    assert.equal(elements['routes-import-box'].hidden, true);
    assert.equal(elements['routes-import-login'].hidden, false);

    hasAccount.value = true;
    updateAccess();
    assert.equal(elements['routes-import-box'].hidden, false);
    assert.equal(elements['routes-import-login'].hidden, true);
});

test('anonymous users cannot view saved community copies but retain their own imports', () => {
    const anonymous = loadRouteTabHelper(false);
    const authenticated = loadRouteTabHelper(true);

    assert.equal(anonymous({ kind: 'imported', communityRouteId: 'community-id' }, 'pending'), false);
    assert.equal(anonymous({ kind: 'imported' }, 'pending'), true);
    assert.equal(authenticated({ kind: 'imported', communityRouteId: 'community-id' }, 'pending'), true);
});

test('community routes, offline map downloads, and route imports use the account gate', () => {
    const community = readAppFile('community-routes.js');
    const offlineMaps = readAppFile('offline-maps.js');
    const routes = readAppFile('routes.js');
    const routeSync = readAppFile('cloud-routes-sync.js');

    assert.match(community, /async function loadCommunityRoutes\(\) \{\s*if \(!requireSignedIn\(/);
    assert.match(community, /async function saveCommunityOffline\([^)]*\) \{\s*if \(!requireSignedIn\(/);
    assert.match(community, /gpx\.addEventListener\('click', \(\) => \{\s*if \(!requireSignedIn\(/);
    assert.match(offlineMaps, /async function downloadRegionOffline\(\) \{\s*if \(!offlineMapsRequireAccount\(\)\) return;/);
    assert.match(offlineMaps, /async function downloadVisibleDetailOffline\(\) \{\s*if \(!offlineMapsRequireAccount\(\)\) return;/);
    assert.match(offlineMaps, /async function downloadTileSetOffline\([^)]*\) \{\s*if \(!offlineMapsRequireAccount\(\)\) return;/);
    assert.match(routes, /if \(tab === 'community' && !requireSignedIn\(/);
    assert.match(routes, /\$\('btn-import-route'\)\.addEventListener\('click', async \(\) => \{\s*if \(!requireSignedIn\(/);
    assert.match(routes, /const inTrash = routesTab === 'trash';\s*const r = \(inTrash \? trashedRoutes : savedRoutes\)\.find\(x => x\.id === id\);\s*if \(!r\) return;\s*if \(inTrash\) \{/);
    assert.match(routes, /if \(r\.communityRouteId\s*&& !requireSignedIn\(/);
    assert.match(routeSync, /async function syncRoutes\(manual = false\) \{\s*if \(!Cloud\.loggedIn\(\)\) return;/);
});
