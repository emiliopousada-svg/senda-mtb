'use strict';

// Selección del entorno de compilación para app/config.js.
//   MTB_APP_ENV       production (por defecto) | staging | development
//   MTB_CLOUD_SERVER  servidor PocketBase alternativo (obligatorio en staging)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CONFIG_PATH = path.join(__dirname, '..', 'app', 'config.js');
const LOCAL_HTTP_SERVER = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/.*)?$/i;

// Lee la tabla de entornos de app/config.js para no duplicarla aquí.
function loadEnvironments(configText = fs.readFileSync(CONFIG_PATH, 'utf8')) {
    const context = vm.createContext({});
    vm.runInContext(`${configText}\n;globalThis.__envs = APP_ENVIRONMENTS; globalThis.__default = APP_DEFAULT_ENV;`, context);
    return { environments: context.__envs, defaultEnv: context.__default };
}

function validateServer(server, allowLocalHttp) {
    let url;
    try { url = new URL(server); }
    catch (error) { throw new Error(`MTB_CLOUD_SERVER no es una URL válida: ${server}`); }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error(`MTB_CLOUD_SERVER no puede llevar credenciales, parámetros ni fragmento: ${server}`);
    }
    const localHttp = url.protocol === 'http:' && LOCAL_HTTP_SERVER.test(server);
    if (url.protocol !== 'https:' && !(allowLocalHttp && localHttp)) {
        throw new Error(allowLocalHttp
            ? `MTB_CLOUD_SERVER debe usar HTTPS o ser un servidor local http://localhost / 127.0.0.1: ${server}`
            : `MTB_CLOUD_SERVER debe usar HTTPS en este entorno: ${server}`);
    }
    const normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    // Se escribe dentro de una cadena JS de config.js: no se admiten comillas ni barras invertidas.
    if (/['"`\\\s]/.test(normalized)) throw new Error(`MTB_CLOUD_SERVER contiene caracteres no permitidos: ${server}`);
    return normalized;
}

function resolveBuildEnvironment(env = process.env, configText) {
    const { environments, defaultEnv } = loadEnvironments(configText);
    const name = String(env.MTB_APP_ENV || defaultEnv).trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(environments, name)) {
        throw new Error(`MTB_APP_ENV no válido: "${name}". Usa uno de: ${Object.keys(environments).join(', ')}.`);
    }
    const settings = environments[name];
    const rawServer = String(env.MTB_CLOUD_SERVER || '').trim();
    const serverOverride = rawServer ? validateServer(rawServer, settings.allowLocalHttpServer) : '';
    if (!serverOverride && !settings.cloudServer) {
        throw new Error(`El entorno ${name} no tiene servidor predeterminado: indica MTB_CLOUD_SERVER.`);
    }
    // Las etiquetas vX.Y.Z publican el APK firmado: solo pueden salir de producción.
    const ref = String(env.GITHUB_REF || '');
    if (ref.startsWith('refs/tags/v') && name !== 'production') {
        throw new Error(`Las releases (${ref}) deben compilarse con MTB_APP_ENV=production, no ${name}.`);
    }
    if (ref.startsWith('refs/tags/v') && serverOverride) {
        throw new Error(`Las releases (${ref}) usan el servidor de producción: quita MTB_CLOUD_SERVER.`);
    }
    return { name, serverOverride, cloudServer: serverOverride || settings.cloudServer, label: settings.label };
}

function applyBuildEnvironment(configText, { name, serverOverride }) {
    const envLine = /const APP_ENV = '[^']*';/;
    const serverLine = /const APP_CLOUD_SERVER_OVERRIDE = '[^']*';/;
    if (!envLine.test(configText)) throw new Error('No se pudo encontrar APP_ENV en app/config.js');
    if (!serverLine.test(configText)) throw new Error('No se pudo encontrar APP_CLOUD_SERVER_OVERRIDE en app/config.js');
    return configText
        .replace(envLine, `const APP_ENV = '${name}';`)
        .replace(serverLine, `const APP_CLOUD_SERVER_OVERRIDE = '${serverOverride}';`);
}

module.exports = { loadEnvironments, resolveBuildEnvironment, applyBuildEnvironment };
