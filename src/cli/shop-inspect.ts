/**
 * Seitenbericht fuer die Selektorpflege.
 *
 * Oeffnet eine Seite des Shops mit der gespeicherten Session, bestaetigt den
 * Cookie-Banner und listet auf, welche Eingabefelder und Schaltflaechen dort
 * tatsaechlich stehen. Damit lassen sich die Selektoren in
 * src/automation/drivers/*.driver.ts nachziehen, ohne raten zu muessen.
 *
 *   npm run shop:inspect -- --shop <shop-id>
 *   npm run shop:inspect -- --shop <shop-id> --url /marktwahl
 *   npm run shop:inspect -- --shop <shop-id> --url https://shop.rewe.de/mydata/login
 *
 * Im Container:
 *   docker compose exec app node dist/cli/shop-inspect.js --shop <id> --url /marktwahl
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { listUsers } from '../db/repo/users.js';
import { listShops } from '../db/repo/shops.js';
import { withDriverContext } from '../automation/context.js';
import { closeBrowser, captureArtifacts } from '../automation/browser.js';
import { describePage, dismissConsentBanner, errorMessage } from '../automation/util.js';
import { requireBrowser } from '../automation/types.js';
import { config } from '../config.js';
import { parseArgs } from './args.js';
import type { ProviderSlug, Shop } from '../core/types.js';

/** Startseiten und Consent-Selektoren je Shop. */
const ENTRY: Record<ProviderSlug, { base: string; consent: string[] }> = {
  rewe: {
    base: 'https://shop.rewe.de',
    consent: [
      '#uc-btn-accept-banner',
      'button[data-testid="uc-accept-all-button"]',
      'button:has-text("Alle akzeptieren")',
      'button:has-text("Akzeptieren")',
    ],
  },
  dm: {
    base: 'https://www.dm.de',
    consent: [
      '#onetrust-accept-btn-handler',
      'button[data-dmid="button-accept-all"]',
      'button:has-text("Alle akzeptieren")',
    ],
  },
  demo: { base: 'https://example.invalid', consent: [] },
};

function table(rows: Array<Record<string, string>>): void {
  if (rows.length === 0) {
    console.log('   (keine gefunden)');
    return;
  }
  for (const row of rows) {
    const { tag, ...rest } = row;
    const details = Object.entries(rest)
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
    console.log(`   <${tag} ${details}>`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  db();

  const shops: Shop[] = listUsers().flatMap((user) => listShops(user.id));
  const shopId = args.get('shop');
  if (!shopId) {
    console.log('Verfuegbare Shops:');
    for (const shop of shops) {
      console.log(`  ${shop.id}  ${shop.provider.padEnd(5)} ${shop.name}`);
    }
    console.log('\nAufruf: npm run shop:inspect -- --shop <shop-id> [--url /pfad]');
    return;
  }

  const shop = shops.find((entry) => entry.id === shopId);
  if (!shop) {
    console.error(`Shop ${shopId} nicht gefunden.`);
    process.exit(1);
  }

  const entry = ENTRY[shop.provider];
  const raw = args.get('url') ?? '/';
  const target = raw.startsWith('http') ? raw : `${entry.base}${raw}`;

  console.log(`Oeffne ${target} …\n`);

  await withDriverContext({ shop, dryRun: true }, async (_driver, ctx) => {
    const { page } = requireBrowser(ctx);
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    if (await dismissConsentBanner(page, entry.consent)) {
      console.log('Cookie-Banner bestaetigt.\n');
    }
    // Auf nachgeladene Inhalte warten – Shops rendern heute fast alles per
    // JavaScript.
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(1200);

    const report = await describePage(page, 30);
    console.log(`Titel:    ${report.title}`);
    console.log(`Adresse:  ${report.url}`);
    if (report.url !== target) console.log('          (umgeleitet)');
    console.log('\nEingabefelder:');
    table(report.inputs);
    console.log('\nSchaltflaechen und Links:');
    table(report.buttons);

    // Eingebettete Rahmen nennen – Anmeldedienste und Consent-Werkzeuge
    // stecken oft darin, und dann ist die Hauptseite erwartungsgemaess leer.
    const frames = page.frames().filter((frame) => frame !== page.mainFrame());
    if (frames.length > 0) {
      console.log('\nEingebettete Rahmen:');
      for (const frame of frames) {
        const hasPassword = await frame
          .locator('input[type="password"]')
          .first()
          .isVisible({ timeout: 400 })
          .catch(() => false);
        console.log(`   ${frame.url()}${hasPassword ? '   <- enthaelt ein Passwortfeld!' : ''}`);
      }
    }

    const folder = path.join(config.artifactDir, 'diagnose');
    const artifacts = await captureArtifacts(page, 'diagnose', `inspect-${shop.provider}`);
    writeFileSync(
      path.join(folder, `inspect-${shop.provider}.json`),
      JSON.stringify(report, null, 2),
      'utf8',
    );
    console.log(`\nScreenshot: ${artifacts.screenshot}`);
    console.log(`HTML:       ${artifacts.html}`);
  }).catch((error: unknown) => {
    console.error(`Fehler: ${errorMessage(error)}`);
  });

  await closeBrowser();
}

void main();
