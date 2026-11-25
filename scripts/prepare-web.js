// Prepara la carpeta www/ que empaqueta Capacitor dentro del APK.
// Copia la app y sus dependencias locales para que no dependa de CDN.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveBuildEnvironment, applyBuildEnvironment } = require('./app-environment');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
const nm = path.join(root, 'node_modules');
const appVersion = require(path.join(root, 'package.json')).version;
const buildNumber = process.env.GITHUB_RUN_NUMBER || '';
if (buildNumber && !/^\d+$/.test(buildNumber)) {
  throw new Error(`Número de build no válido en GITHUB_RUN_NUMBER: ${buildNumber}`);
}
const appBuild = buildNumber || 'local';
const appEnvironment = resolveBuildEnvironment(process.env);

if (!/^\d+\.\d+\.\d+$/.test(appVersion)) {
  throw new Error(`Versión de aplicación no válida en package.json: ${appVersion}`);
}

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'lib', 'leaflet'), { recursive: true });

for (const f of ['index.html', 'manifest.json', 'icon.svg']) {
  fs.copyFileSync(path.join(root, f), path.join(www, f));
}
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'estrella-galicia.svg']) {
  const source = path.join(root, f);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(www, f));
}
const appReadme = path.join(root, 'app', 'README.md');
fs.cpSync(path.join(root, 'app'), path.join(www, 'app'), {
  recursive: true,
  filter: source => path.resolve(source) !== appReadme
});
const appConfig = path.join(www, 'app', 'config.js');
const configText = fs.readFileSync(appConfig, 'utf8');
if (!/const APP_VERSION = '[^']*';/.test(configText)) {
  throw new Error('No se pudo encontrar APP_VERSION en app/config.js');
}
if (!/const APP_BUILD = '[^']*';/.test(configText)) {
  throw new Error('No se pudo encontrar APP_BUILD en app/config.js');
}
const versionedConfig = configText.replace(
  /const APP_VERSION = '[^']*';/,
  `const APP_VERSION = '${appVersion}';`
).replace(
  /const APP_BUILD = '[^']*';/,
  `const APP_BUILD = '${appBuild}';`
);
fs.writeFileSync(appConfig, applyBuildEnvironment(versionedConfig, appEnvironment));
fs.copyFileSync(path.join(nm, 'leaflet/dist/leaflet.css'), path.join(www, 'lib/leaflet/leaflet.css'));
fs.copyFileSync(path.join(nm, 'leaflet/dist/leaflet.js'), path.join(www, 'lib/leaflet/leaflet.js'));
fs.copyFileSync(path.join(root, 'vendor/leaflet-rotate.umd.min.js'), path.join(www, 'lib/leaflet/leaflet-rotate.umd.min.js'));
fs.cpSync(path.join(nm, 'leaflet/dist/images'), path.join(www, 'lib/leaflet/images'), { recursive: true });
fs.copyFileSync(path.join(nm, 'chart.js/dist/chart.umd.js'), path.join(www, 'lib/chart.umd.js'));
fs.copyFileSync(path.join(nm, 'maplibre-gl/dist/maplibre-gl.css'), path.join(www, 'lib/maplibre-gl.css'));

// El módulo BLE usa imports de npm: se empaqueta como script clásico para Capacitor.
require('esbuild').buildSync({
  entryPoints: [path.join(nm, 'maplibre-gl/dist/maplibre-gl.mjs')],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'maplibregl',
  target: 'es2019',
  outfile: path.join(www, 'lib/maplibre-gl.js')
});

require('esbuild').buildSync({
  entryPoints: [path.join(root, 'src', 'ble.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  outfile: path.join(www, 'lib/ble.js')
});

require('esbuild').buildSync({
  entryPoints: [path.join(root, 'src', 'fit-parser.mjs')],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'MTBFit',
  target: 'es2019',
  outfile: path.join(www, 'lib/fit.js')
});

require('esbuild').buildSync({
  entryPoints: [path.join(root, 'src', 'native-app.mjs')],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'MTBNativeApp',
  target: 'es2019',
  outfile: path.join(www, 'lib/native-app.js')
});

const file = path.join(www, 'index.html');
let html = fs.readFileSync(file, 'utf8');
const versionLabel = /(<strong id="app-version">)v\d+\.\d+\.\d+ \(build [^)]+\)(<\/strong>)/;
if (!versionLabel.test(html)) {
  throw new Error('No se pudo encontrar la etiqueta de versión en index.html');
}
html = html.replace(versionLabel, `$1v${appVersion} (build ${appBuild})$2`);
fs.writeFileSync(file, html);

// Comprueba que el HTML que se empaquetará no referencia scripts o CSS locales ausentes.
const localAssets = [
  ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi),
  ...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)
].map(match => match[1]);
for (const asset of localAssets) {
  if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(asset)) continue;
  const assetPath = decodeURIComponent(asset.split(/[?#]/, 1)[0]);
  if (!fs.existsSync(path.join(www, assetPath))) {
    throw new Error(`index.html referencia un recurso local que no existe en www/: ${asset}`);
  }
}

const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
// Every build gets a distinct shell cache, including same-version app updates.
const swHash = crypto.randomBytes(8).toString('hex');
for (const marker of ['__APP_VERSION__', '__SW_HASH__']) {
  if (!swSource.includes(marker)) {
    throw new Error(`No se encontró el marcador ${marker} en sw.js`);
  }
}
const builtSw = swSource
  .replace('__APP_VERSION__', appVersion)
  .replace('__SW_HASH__', swHash);
if (builtSw.includes('__APP_VERSION__') || builtSw.includes('__SW_HASH__')) {
  throw new Error('Quedaron marcadores sin sustituir en el service worker generado');
}
fs.writeFileSync(
  path.join(www, 'sw.js'),
  builtSw
);
console.log(`www listo (service worker ${appVersion}, entorno ${appEnvironment.name}, servidor ${appEnvironment.cloudServer})`);
