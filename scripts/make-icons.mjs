// Erzeugt die App-Icons aus einem SVG – gerendert mit dem Chromium, der
// ohnehin fuer die Bestellungen installiert ist.
//   node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SIZES = [180, 192, 512];
const OUT = 'web/public/icons';

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b8f5b"/>
      <stop offset="1" stop-color="#175734"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round">
    <path d="M126 138h44l40 172h150l38-118H186"/>
    <circle cx="228" cy="368" r="24" fill="#ffffff" stroke="none"/>
    <circle cx="342" cy="368" r="24" fill="#ffffff" stroke="none"/>
    <path d="M300 160v76M262 198h76"/>
  </g>
</svg>`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<html><body style="margin:0">${svg(size)}</body></html>`,
    { waitUntil: 'load' },
  );
  const buffer = await page.screenshot({ omitBackground: false });
  writeFileSync(`${OUT}/icon-${size}.png`, buffer);
  await page.close();
  console.log(`[autohouse] ${OUT}/icon-${size}.png erzeugt`);
}

// Maskierbares Icon (Android) – gleiches Motiv mit mehr Rand.
await browser.close();
