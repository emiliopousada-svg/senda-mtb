#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = path.resolve(process.env.DEM_ROOT || './dem-data');
const MANIFEST_PATH = path.resolve(process.env.DEM_MANIFEST || './dem/ign-mdt05-manifest.json');
const REGIONS = new Set(['andalucia','aragon','asturias','baleares','canarias','cantabria','castilla-la-mancha','castilla-y-leon','cataluna','ceuta','extremadura','galicia','la-rioja','madrid','melilla','murcia','navarra','pais-vasco','comunidad-valenciana']);

function usage() {
  console.log('Uso: node scripts/download-dem-cog.mjs [--region all|galicia|...] [--check]');
  console.log('Variables: DEM_ROOT (destino NAS), DEM_MANIFEST (manifiesto con URLs y SHA-256).');
}
function parseArgs(args) {
  const options = { region: 'all', check: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') { usage(); process.exit(0); }
    else if (args[i] === '--check') options.check = true;
    else if (args[i] === '--region') options.region = args[++i] || '';
    else throw new Error('Argumento desconocido: ' + args[i]);
  }
  if (options.region !== 'all' && !REGIONS.has(options.region)) throw new Error('Región no válida: ' + options.region);
  return options;
}
function safeFilename(name) { return typeof name === 'string' && /^[A-Za-z0-9._-]+\.tif$/i.test(name); }
function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256'), stream = createReadStream(file);
    stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
async function loadManifest() {
  const raw = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.files)) throw new Error('Manifiesto inválido: schemaVersion=1 y files[] requeridos.');
  const ids = new Set(), names = new Set();
  for (const item of raw.files) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id)) throw new Error('ID ausente o duplicado.');
    ids.add(item.id);
    if (!safeFilename(item.filename) || names.has(item.filename)) throw new Error('Nombre de archivo no seguro o duplicado: ' + item.filename);
    names.add(item.filename);
    if (!/^https:\/\/[^/]+\/.+/i.test(item.url || '')) throw new Error('URL HTTPS inválida: ' + item.id);
    if (!/^[a-f0-9]{64}$/i.test(item.sha256 || '')) throw new Error('Falta SHA-256 válido: ' + item.id);
    if (!Number.isSafeInteger(item.bytes) || item.bytes <= 0) throw new Error('Tamaño inválido: ' + item.id);
    if (!Array.isArray(item.regions) || !item.regions.length || item.regions.some(r => !REGIONS.has(r))) throw new Error('Regiones inválidas: ' + item.id);
  }
  return raw;
}
async function downloadOne(item, filesDir, checkOnly) {
  const target = path.join(filesDir, item.filename), partial = target + '.part';
  try {
    const info = await stat(target);
    if (info.size === item.bytes && (await sha256(target)).toLowerCase() === item.sha256.toLowerCase()) { console.log('OK', item.filename); return; }
    if (checkOnly) throw new Error('Archivo existente no coincide: ' + item.filename);
    await unlink(target);
  } catch (error) {
    if (error.code !== 'ENOENT' && !String(error.message).startsWith('Archivo existente')) throw error;
    if (checkOnly) throw error;
  }
  if (checkOnly) throw new Error('Falta archivo: ' + item.filename);
  await unlink(partial).catch(() => {});
  const response = await fetch(item.url, { redirect: 'follow', signal: AbortSignal.timeout(1800000) });
  if (!response.ok || !response.body) throw new Error('HTTP ' + response.status + ': ' + item.filename);
  try {
    await pipeline(response.body, createWriteStream(partial, { flags: 'wx' }));
    const info = await stat(partial);
    if (info.size !== item.bytes) throw new Error('Tamaño incorrecto: ' + item.filename + ' (' + info.size + '/' + item.bytes + ')');
    if ((await sha256(partial)).toLowerCase() !== item.sha256.toLowerCase()) throw new Error('SHA-256 incorrecto: ' + item.filename);
    await rename(partial, target);
    console.log('DESCARGADO', item.filename);
  } catch (error) { await unlink(partial).catch(() => {}); throw error; }
}
async function main() {
  const options = parseArgs(process.argv.slice(2)), manifest = await loadManifest();
  const selected = manifest.files.filter(f => options.region === 'all' || f.regions.includes(options.region));
  if (!selected.length) throw new Error('El manifiesto no contiene archivos para esa selección.');
  const filesDir = path.join(ROOT, 'files'); await mkdir(filesDir, { recursive: true });
  let failures = 0;
  for (const item of selected) {
    try { await downloadOne(item, filesDir, options.check); }
    catch (error) { failures++; console.error('ERROR', item.filename, '-', error.message); }
  }
  if (failures) throw new Error(failures + ' archivo(s) pendientes; puede volver a ejecutar el comando.');
  // Mantener en el índice todas las regiones ya instaladas, aunque esta ejecución descargue solo una.
  const installed = [];
  for (const item of manifest.files) {
    try {
      const info = await stat(path.join(filesDir, item.filename));
      if (info.size === item.bytes && (await sha256(path.join(filesDir, item.filename))).toLowerCase() === item.sha256.toLowerCase()) installed.push(item);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const publicManifest = {
    schemaVersion: 1, dataset: manifest.dataset, attribution: manifest.attribution, license: manifest.license,
    generatedAt: new Date().toISOString(),
    regions: Object.fromEntries([...REGIONS].map(region => [region, installed.filter(f => f.regions.includes(region)).map(f => ({
      id: f.id, filename: f.filename, url: 'files/' + encodeURIComponent(f.filename), bytes: f.bytes, sha256: f.sha256, bounds: f.bounds || null
    }))]).filter(([, files]) => files.length))
  };
  await writeFile(path.join(ROOT, 'manifest.json'), JSON.stringify(publicManifest, null, 2) + '\n', 'utf8');
  console.log('Manifiesto público generado:', path.join(ROOT, 'manifest.json'));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
