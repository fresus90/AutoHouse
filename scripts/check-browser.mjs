// Weist nach dem npm install darauf hin, ob der Chromium-Build vorhanden ist.
// Bricht bewusst nie ab – die App laeuft auch ohne Browser (UI + Dry-Run-Planung).
import { existsSync } from 'node:fs';

const path = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (process.env.CI || process.env.AUTOHOUSE_SKIP_BROWSER_CHECK) process.exit(0);
if (path && existsSync(path)) {
  console.log(`[autohouse] Playwright-Browser gefunden unter ${path}`);
} else {
  console.log(
    '[autohouse] Kein Playwright-Browser gefunden. Einmalig ausfuehren:\n' +
      '            npx playwright install --with-deps chromium',
  );
}
