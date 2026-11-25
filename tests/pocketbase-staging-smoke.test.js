'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    COMMUNITY_COLLECTIONS,
    runStagingSmoke,
    validateStagingServer
} = require('../scripts/pocketbase-staging-smoke.js');

test('staging smoke accepts HTTPS staging and rejects production or unsafe URLs', () => {
    assert.equal(validateStagingServer('https://pb-staging.example.test/'), 'https://pb-staging.example.test');
    assert.throws(() => validateStagingServer('http://pb-staging.example.test'), /HTTPS/);
    assert.throws(() => validateStagingServer('https://mtbpro.ddns.net'), /no a producción/);
    assert.throws(() => validateStagingServer('https://user:pass@pb-staging.example.test'), /no a producción/);
});

test('staging smoke checks health, authenticated collection reads, and a non-mutating custom-hook probe', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url: String(url), options });
        if (url.pathname === '/api/health') return new Response('{}', { status: 200 });
        if (url.pathname === '/api/collections/users/auth-with-password') {
            return new Response(JSON.stringify({ token: 'test-token', record: { id: 'test-user' } }), { status: 200 });
        }
        if (url.pathname.startsWith('/api/collections/')) {
            return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (url.pathname === '/api/mtb/groups/create') {
            return new Response(JSON.stringify({ message: 'Escribe un nombre para el grupo.' }), { status: 400 });
        }
        return new Response('{}', { status: 404 });
    };

    const result = await runStagingSmoke({
        server: 'https://pb-staging.example.test',
        email: 'smoke@example.test',
        password: 'not-a-real-password',
        fetchImpl
    });

    assert.equal(result.collectionsChecked, 3);
    assert.deepEqual(
        calls.filter(call => call.url.includes('/api/collections/')).map(call => {
            const collection = call.url.match(/collections\/([^/]+)\//)[1];
            return collection;
        }),
        ['users', ...COMMUNITY_COLLECTIONS]
    );
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.equal(calls.at(-1).options.body, JSON.stringify({ name: '' }));
    assert.equal(calls.at(-1).options.redirect, 'error');
    assert.equal(calls.at(-1).options.cache, 'no-store');
});

test('staging smoke fails explicitly when credentials are missing', async () => {
    await assert.rejects(
        runStagingSmoke({
            server: 'https://pb-staging.example.test',
            email: '',
            password: '',
            fetchImpl: async () => { throw new Error('fetch should not run'); }
        }),
        /PB_STAGING_SMOKE_EMAIL/
    );
});
