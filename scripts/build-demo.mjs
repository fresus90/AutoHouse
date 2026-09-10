// Baut das Frontend im Demo-Modus zu EINER HTML-Datei.
//
//   node scripts/build-demo.mjs
//   -> dist/demo/autohouse-demo.html
//
// Die Datei laeuft ohne Server: doppelklicken, per AirDrop aufs Telefon
// schicken oder als Artifact veroeffentlichen. Sie enthaelt Beispieldaten
// im Speicher und stellt keinerlei Netzwerkanfragen.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = 'dist/demo';
const BUILD_DIR = 'dist/demo-build';

rmSync(BUILD_DIR, { recursive: true, force: true });

execFileSync(
  'npx',
  ['vite', 'build', '--config', 'web/vite.config.ts', '--outDir', `../${BUILD_DIR}`, '--base', './'],
  { stdio: 'inherit', env: { ...process.env, VITE_DEMO: '1' } },
);

const assetDir = path.join(BUILD_DIR, 'assets');
const assets = readdirSync(assetDir);
const jsFile = assets.find((file) => file.endsWith('.js'));
const cssFile = assets.find((file) => file.endsWith('.css'));
if (!jsFile || !cssFile) throw new Error('Gebaute Dateien nicht gefunden.');

const js = readFileSync(path.join(assetDir, jsFile), 'utf8');
const css = readFileSync(path.join(assetDir, cssFile), 'utf8');

/**
 * Die App richtet sich nach der Systemeinstellung (prefers-color-scheme).
 * Als veroeffentlichte Seite kann der Betrachter das Thema aber auch fest
 * waehlen – das steht dann als data-theme am Wurzelelement. Damit beides
 * zusammenpasst, werden dieselben Farbwerte hier zusaetzlich unter
 * data-theme ausgegeben. Die App-CSS bleibt davon unberuehrt.
 */
function themeOverrides(source) {
  const light = /:root\{([^}]*)\}/.exec(source)?.[1];
  const dark = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\{([^}]*)\}/.exec(source)?.[1];
  if (!light || !dark) {
    console.warn('[autohouse] Farbtokens nicht gefunden – data-theme wird nicht ergaenzt.');
    return '';
  }
  return `\n/* Feste Themenwahl des Betrachters */\n:root[data-theme="light"]{${light}}\n:root[data-theme="dark"]{${dark}}\n`;
}

// Ohne <html>/<head>/<body>: So kann die Datei direkt als Artifact
// veroeffentlicht werden, und im Browser laeuft sie trotzdem.
//
// Das Viewport-Meta muss mit in die Datei: Wird sie direkt auf dem Telefon
// geoeffnet (AirDrop, Datei-App), rendert Safari sonst in 980 px Breite und
// das Handy-Layout greift nicht.
const html = `<title>AutoHouse</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="description" content="Oberflaeche von AutoHouse mit Beispieldaten – ohne Server, ohne echte Bestellungen." />
<style>
${css}${themeOverrides(css)}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;

mkdirSync(OUT_DIR, { recursive: true });
const target = path.join(OUT_DIR, 'autohouse-demo.html');
writeFileSync(target, html, 'utf8');
rmSync(BUILD_DIR, { recursive: true, force: true });

const size = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`\n[autohouse] ${target} geschrieben (${size} kB, eine einzelne Datei)`);
