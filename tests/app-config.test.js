'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { resolveBuildEnvironment, applyBuildEnvironment } = require('../scripts/app-environment');

const root = path.join(__dirname, '..');
const configSource = fs.readFileSync(path.join(root, 'app', 'config.js'), 'utf8');
const cloudSource = fs.readFileSync(path.join(root, 'app', 'cloud.js'), 'utf8');

// Carga config.js y normalizeServer() de cloud.js como lo haría el navegador.
function loadRuntime(configText) {
    const normalizeServer = cloudSource.match(/function normalizeServer\(v\) \{[\s\S]*?\n\}/);
    assert.ok(normalizeServer, 'normalizeServer() debe existir en app/cloud.js');
    const context = vm.createContext({ URL });
    vm.runInContext(`${configText}\n${normalizeServer[0]}\n;globalThis.out = { APP_CONFIG, DEFAULT_CLOUD_SERVER, normalizeServer };`, context);
    return context.out;
}

function buildConfig(env) {
    return applyBuildEnvironment(configSource, resolveBuildEnvironment(env, configSource));
}

test('sin compilar, la app usa producción y el servidor mtbpro.ddns.net', () => {
    const { APP_CONFIG, DEFAULT_CLOUD_SERVER } = loadRuntime(configSource);
    assert.equal(APP_CONFIG.env, 'production');
    assert.equal(APP_CONFIG.isProduction, true);
    assert.equal(APP_CONFIG.allowLocalHttpServer, false);
    assert.equal(DEFAULT_CLOUD_SERVER, 'https://mtbpro.ddns.net');
});

test('la compilación por defecto (releases) deja producción sin cambios', () => {
    const env = resolveBuildEnvironment({ GITHUB_REF: 'refs/tags/v9.9.9' }, configSource);
    assert.deepEqual(env, { name: 'production', serverOverride: '', cloudServer: 'https://mtbpro.ddns.net', label: 'Producción' });
    assert.equal(applyBuildEnvironment(configSource, env), configSource);
});

test('desarrollo apunta al PocketBase local y admite http solo en loopback', () => {
    const { APP_CONFIG, DEFAULT_CLOUD_SERVER, normalizeServer } = loadRuntime(buildConfig({ MTB_APP_ENV: 'development' }));
    assert.equal(APP_CONFIG.env, 'development');
    assert.equal(DEFAULT_CLOUD_SERVER, 'http://127.0.0.1:8090');
    assert.equal(normalizeServer('http://127.0.0.1:8090/'), 'http://127.0.0.1:8090');
    assert.equal(normalizeServer('http://localhost:8090'), 'http://localhost:8090');
    // Un host remoto con http se sigue forzando a HTTPS.
    assert.equal(normalizeServer('http://mtbpro.ddns.net'), 'https://mtbpro.ddns.net');
    assert.equal(normalizeServer('http://localhost.evil.example'), 'https://localhost.evil.example');
});

test('producción nunca acepta un servidor http local', () => {
    const { normalizeServer } = loadRuntime(configSource);
    assert.equal(normalizeServer('http://127.0.0.1:8090'), 'https://127.0.0.1:8090');
    assert.equal(normalizeServer('mtbpro.ddns.net/'), 'https://mtbpro.ddns.net');
    assert.throws(() => normalizeServer('ftp://mtbpro.ddns.net'), /HTTPS/);
});

test('pruebas exige MTB_CLOUD_SERVER con HTTPS', () => {
    assert.throws(() => resolveBuildEnvironment({ MTB_APP_ENV: 'staging' }, configSource), /MTB_CLOUD_SERVER/);
    assert.throws(() => resolveBuildEnvironment({ MTB_APP_ENV: 'staging', MTB_CLOUD_SERVER: 'http://127.0.0.1:8090' }, configSource), /HTTPS/);
    const { APP_CONFIG, DEFAULT_CLOUD_SERVER } = loadRuntime(buildConfig({ MTB_APP_ENV: 'staging', MTB_CLOUD_SERVER: 'https://pruebas.example.com/' }));
    assert.equal(APP_CONFIG.env, 'staging');
    assert.equal(APP_CONFIG.label, 'Pruebas');
    assert.equal(DEFAULT_CLOUD_SERVER, 'https://pruebas.example.com');
});

test('rechaza entornos desconocidos, releases fuera de producción y URLs peligrosas', () => {
    assert.throws(() => resolveBuildEnvironment({ MTB_APP_ENV: 'qa' }, configSource), /MTB_APP_ENV no válido/);
    assert.throws(() => resolveBuildEnvironment({ MTB_APP_ENV: 'development', GITHUB_REF: 'refs/tags/v1.0.0' }, configSource), /production/);
    assert.throws(() => resolveBuildEnvironment({ MTB_CLOUD_SERVER: 'https://otro.example.com', GITHUB_REF: 'refs/tags/v1.0.0' }, configSource), /producción/);
    assert.throws(() => resolveBuildEnvironment({ MTB_CLOUD_SERVER: "https://a.example.com/x'y" }, configSource), /no permitidos/);
    assert.throws(() => resolveBuildEnvironment({ MTB_CLOUD_SERVER: 'https://user:pass@a.example.com' }, configSource), /credenciales/);
});

test('un APP_ENV desconocido en tiempo de ejecución vuelve a producción', () => {
    const tampered = configSource.replace(/const APP_ENV = '[^']*';/, "const APP_ENV = 'inventado';");
    const { APP_CONFIG, DEFAULT_CLOUD_SERVER } = loadRuntime(tampered);
    assert.equal(APP_CONFIG.env, 'production');
    assert.equal(DEFAULT_CLOUD_SERVER, 'https://mtbpro.ddns.net');
});

test('la inicialización recupera un servidor de PocketBase guardado no válido', () => {
    const initialization = cloudSource.slice(0, cloudSource.indexOf('function renderAccount()'));
    const values = new Map([
        ['mtb_pro_server', 'not a url'],
        ['mtb_pro_token', 'old-token'],
        ['mtb_pro_uid', 'old-user']
    ]);
    const context = vm.createContext({
        URL,
        console: { warn() {} },
        localStorage: {
            getItem: key => values.has(key) ? values.get(key) : null,
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: key => values.delete(key)
        }
    });

    vm.runInContext(`${configSource}\n${initialization}\nglobalThis.__cloud = Cloud; globalThis.__serverWasReset = cloudServerWasResetOnLoad;`, context);

    assert.equal(values.get('mtb_pro_server'), 'https://mtbpro.ddns.net');
    assert.equal(context.__cloud.loggedIn(), false);
    assert.equal(context.__serverWasReset, true);
});

test('los caracteres $ de la URL se copian literalmente en config.js', () => {
    for (const server of ['https://pruebas.example.com/$&', 'https://pruebas.example.com/a$$b', "https://pruebas.example.com/$'"]) {
        const env = { MTB_APP_ENV: 'staging', MTB_CLOUD_SERVER: server };
        if (server.endsWith("'")) {
            assert.throws(() => resolveBuildEnvironment(env, configSource), /no permitidos/);
            continue;
        }
        const { DEFAULT_CLOUD_SERVER } = loadRuntime(buildConfig(env));
        assert.equal(DEFAULT_CLOUD_SERVER, server);
    }
});
