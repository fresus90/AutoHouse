/**
 * Seitenbericht fuer die Selektorpflege.
 *
 * Oeffnet eine Seite, bestaetigt den Cookie-Banner und listet auf, welche
 * Eingabefelder und Schaltflaechen dort tatsaechlich stehen. Damit lassen
 * sich die Selektoren in src/automation/drivers/*.driver.ts nachziehen, ohne
 * raten zu muessen.
 *
 * Ohne angelegten Shop – fuer beliebige Adressen:
 *   npm run shop:inspect -- --url https://www.knuspr.de/anmeldung
 *
 * Mit angelegtem Shop – nutzt dessen gespeicherte Anmeldung und erlaubt
 * damit auch Seiten hinter dem Login:
 *   npm run shop:inspect -- --shop <shop-id> --url /marktwahl
 *
 * Im Container jeweils:
 *   docker compose exec app node dist/cli/shop-inspect.js --url https://…
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { db } from '../db/index.js';
import { listUsers } from '../db/repo/users.js';
import { listShops } from '../db/repo/shops.js';
import { withDriverContext } from '../automation/context.js';
import { captureArtifacts, closeBrowser, createSession } from '../automation/browser.js';
import {
  GENERIC_CONSENT,
  describePage,
  detectBotChallenge,
  dismissConsentBanner,
  errorMessage,
  findLoginFields,
  waitOutBotChallenge,
} from '../automation/util.js';
import { requireBrowser } from '../automation/types.js';
import { config } from '../config.js';
import { parseArgs } from './args.js';
import type { ProviderSlug, Shop } from '../core/types.js';

/** Basisadressen der bekannten Shops – fuer Pfadangaben wie "/marktwahl". */
const BASE: Record<ProviderSlug, string> = {
  rewe: 'https://shop.rewe.de',
  dm: 'https://www.dm.de',
  demo: 'https://example.invalid',
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

/**
 * Beschreibt ein gefundenes Feld so, wie man es als Selektor notieren wuerde –
 * nicht ueber die internen Markierungen der Suche.
 */
async function describeField(page: Page, marker: string): Promise<string> {
  const info = await page
    .locator(marker)
    .first()
    .evaluate((element) => {
      const pick = (name: string): string => element.getAttribute(name) ?? '';
      const parts = ['id', 'name', 'data-testid', 'type', 'autocomplete']
        .map((attribute) => ({ attribute, value: pick(attribute) }))
        .filter((entry) => entry.value);
      return { tag: element.tagName.toLowerCase(), parts };
    })
    .catch(() => null);
  if (!info) return marker;

  const best = info.parts.find((entry) => ['id', 'name', 'data-testid'].includes(entry.attribute));
  const selector = best ? `${info.tag}[${best.attribute}="${best.value}"]` : info.tag;
  const rest = info.parts
    .filter((entry) => entry !== best)
    .map((entry) => `${entry.attribute}=${entry.value}`)
    .join(', ');
  return rest ? `${selector}   (${rest})` : selector;
}

interface ReportOptions {
  /** Vor dem Bericht dieses Element anklicken (z. B. "Anmelden"). */
  click?: string | undefined;
  /** Statt des Ueberblicks gezielt diese Elemente auflisten. */
  selector?: string | undefined;
}

/** Der eigentliche Bericht – unabhaengig davon, woher die Seite kommt. */
async function report(
  page: Page,
  target: string,
  slug: string,
  options: ReportOptions = {},
): Promise<void> {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  const challenge = await waitOutBotChallenge(page, 20_000);
  if (!challenge.passed && challenge.challenge) {
    const vendor = challenge.challenge.vendor ? ` (${challenge.challenge.vendor})` : '';
    console.log(`Achtung: Pruefseite der Bot-Erkennung "${challenge.challenge.label}"${vendor}\n`);
  }

  if (await dismissConsentBanner(page, [...GENERIC_CONSENT])) {
    console.log('Cookie-Banner bestaetigt.\n');
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1200);

  // Manche Masken oeffnen sich erst auf Klick – etwa ein Konto-Symbol im Kopf.
  if (options.click) {
    const clicked = await page
      .getByText(options.click, { exact: false })
      .first()
      .click({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    console.log(
      clicked
        ? `"${options.click}" angeklickt.\n`
        : `"${options.click}" nicht gefunden – Bericht zeigt die Seite unveraendert.\n`,
    );
    await page.waitForTimeout(1500);
  }

  if (options.selector) {
    const elements = await page
      .locator(options.selector)
      .evaluateAll((nodes) =>
        nodes.slice(0, 15).map((node) => ({
          tag: node.tagName.toLowerCase(),
          class: (node.getAttribute('class') ?? '').slice(0, 60),
          text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
          html: node.outerHTML.slice(0, 300),
        })),
      )
      .catch(() => []);
    console.log(`Treffer fuer "${options.selector}": ${elements.length}\n`);
    for (const element of elements) {
      console.log(`   <${element.tag} class="${element.class}">`);
      console.log(`      Text: ${element.text}`);
      console.log(`      HTML: ${element.html}\n`);
    }
  }

  const pageReport = await describePage(page, 30);
  console.log(`Titel:    ${pageReport.title}`);
  console.log(`Adresse:  ${pageReport.url}`);
  if (pageReport.url !== target) console.log('          (umgeleitet)');

  const stillChallenged = await detectBotChallenge(page);
  if (stillChallenged) {
    const vendor = stillChallenged.vendor ? ` (${stillChallenged.vendor})` : '';
    console.log(`Pruefung: ${stillChallenged.label}${vendor}`);
  }

  const fields = await findLoginFields(page);
  if (fields.user) {
    const user = await describeField(page, fields.user);
    const pass = fields.password ? await describeField(page, fields.password) : null;
    console.log(`Login:    Benutzerfeld ${user}`);
    console.log(`          Passwortfeld ${pass ?? '– fehlt, vermutlich mehrstufige Anmeldung'}`);
  }

  console.log('\nEingabefelder:');
  table(pageReport.inputs);
  console.log('\nSchaltflaechen und Links:');
  table(pageReport.buttons);

  if (pageReport.repeated.length > 0) {
    console.log('\nWiederkehrende Bloecke (meist die Produktkacheln):');
    for (const group of pageReport.repeated) {
      console.log(`   ${group.count}x  ${group.selector}`);
      console.log(`        Beispiel: ${group.sample}`);
    }
  }

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
  mkdirSync(folder, { recursive: true });
  const artifacts = await captureArtifacts(page, 'diagnose', `inspect-${slug}`);
  writeFileSync(path.join(folder, `inspect-${slug}.json`), JSON.stringify(pageReport, null, 2), 'utf8');
  console.log(`\nScreenshot: ${artifacts.screenshot}`);
  console.log(`HTML:       ${artifacts.html}`);
}

function usage(): void {
  console.log(
    'Aufruf:\n' +
      '  npm run shop:inspect -- --url https://www.beispiel.de/anmelden\n' +
      '  npm run shop:inspect -- --shop <shop-id> --url /marktwahl\n\n' +
      'Ohne --shop wird ohne gespeicherte Anmeldung geoeffnet; das genuegt fuer\n' +
      'oeffentliche Seiten wie Anmeldemasken und Produktsuchen.\n\n' +
      'Zusaetzlich:\n' +
      '  --click "Anmelden"      oeffnet eine Maske, die erst auf Klick erscheint\n' +
      '  --selector "<css>"      listet gezielt diese Elemente samt HTML auf',
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const shopId = args.get('shop');
  const raw = args.get('url');

  // --- Ohne Shop: einfach die Adresse oeffnen ------------------------------
  if (!shopId) {
    if (!raw || !raw.startsWith('http')) {
      if (raw) console.error('Ohne --shop muss --url eine vollstaendige Adresse sein.\n');
      usage();
      // Falls doch schon Shops angelegt sind, der Bequemlichkeit halber zeigen.
      try {
        const shops = listUsers().flatMap((user) => listShops(user.id));
        if (shops.length > 0) {
          console.log('\nAngelegte Shops:');
          for (const shop of shops) console.log(`  ${shop.id}  ${shop.provider.padEnd(5)} ${shop.name}`);
        }
      } catch {
        // keine Datenbank vorhanden – nicht schlimm
      }
      return;
    }

    const slug = new URL(raw).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-');
    console.log(`Oeffne ${raw} (ohne gespeicherte Anmeldung) …\n`);
    const session = await createSession({});
    try {
      await report(session.page, raw, slug, {
        click: args.get('click'),
        selector: args.get('selector'),
      });
    } catch (error) {
      console.error(`Fehler: ${errorMessage(error)}`);
    } finally {
      await session.close();
      await closeBrowser();
    }
    return;
  }

  // --- Mit Shop: gespeicherte Anmeldung mitbenutzen ------------------------
  db();
  const shops: Shop[] = listUsers().flatMap((user) => listShops(user.id));
  const shop = shops.find((entry) => entry.id === shopId);
  if (!shop) {
    console.error(`Shop ${shopId} nicht gefunden.\n`);
    console.log('Angelegte Shops:');
    for (const entry of shops) console.log(`  ${entry.id}  ${entry.provider.padEnd(5)} ${entry.name}`);
    process.exit(1);
  }

  const target = raw?.startsWith('http') ? raw : `${BASE[shop.provider]}${raw ?? '/'}`;
  console.log(`Oeffne ${target} mit der Anmeldung von "${shop.name}" …\n`);

  await withDriverContext({ shop, dryRun: true }, async (_driver, ctx) => {
    const { page } = requireBrowser(ctx);
    await report(page, target, shop.provider, {
      click: args.get('click'),
      selector: args.get('selector'),
    });
  }).catch((error: unknown) => {
    console.error(`Fehler: ${errorMessage(error)}`);
  });

  await closeBrowser();
}

void main();
