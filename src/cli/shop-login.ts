/**
 * Login-Assistent.
 *
 * Bei dm und REWE ist der erste Login der fragilste Schritt (Captcha, 2FA,
 * Bot-Erkennung). Statt das automatisiert zu erzwingen, oeffnet dieses Skript
 * einen sichtbaren Browser: anmelden, Enter druecken – die Session wird
 * verschluesselt gespeichert und von allen weiteren Laeufen wiederverwendet.
 *
 *   npm run shop:login -- --shop <shop-id> [--headless]
 *   npm run shop:login -- --list
 */
import { createInterface } from 'node:readline/promises';
import { db } from '../db/index.js';
import { listUsers } from '../db/repo/users.js';
import { getCredentials, listShops, setConnectionStatus } from '../db/repo/shops.js';
import { withDriverContext } from '../automation/context.js';
import { closeBrowser } from '../automation/browser.js';
import { errorMessage } from '../automation/util.js';
import { parseArgs } from './args.js';
import type { Shop } from '../core/types.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  db();

  const shops: Shop[] = listUsers().flatMap((user) => listShops(user.id));
  const shopId = args.get('shop');
  if (args.flag('list') || !shopId) {
    console.log('Verfuegbare Shops:');
    for (const shop of shops) {
      console.log(
        `  ${shop.id}  ${shop.provider.padEnd(5)} ${shop.name}` +
          `  [Session: ${shop.hasSession ? 'vorhanden' : 'keine'}]`,
      );
    }
    if (!shopId) {
      console.log('\nAufruf: npm run shop:login -- --shop <shop-id>');
      return;
    }
  }

  const shop = shops.find((entry) => entry.id === shopId);
  if (!shop) {
    console.error(`Shop ${shopId} nicht gefunden.`);
    process.exit(1);
  }

  const headless = args.flag('headless');
  console.log(`Oeffne ${shop.name} (${shop.provider}) – headless=${headless}`);

  await withDriverContext(
    { shop, dryRun: true, headless, freshSession: true },
    async (driver, ctx) => {
      await driver.prepare(ctx);

      if (headless) {
        const credentials = getCredentials(shop.id);
        if (!credentials) {
          console.error('Fuer den Headless-Betrieb muessen Zugangsdaten am Shop hinterlegt sein.');
          return;
        }
        const result = await driver.login(ctx, credentials);
        setConnectionStatus(shop.id, result.ok ? 'ok' : 'error', result.message ?? null);
        console.log(result.ok ? 'Anmeldung erfolgreich.' : `Fehlgeschlagen: ${result.message}`);
        return;
      }

      console.log(
        '\nBitte im geoeffneten Browser anmelden (inkl. Captcha/2FA).\n' +
          'Danach hier Enter druecken, damit die Session gespeichert wird.',
      );
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await rl.question('> ');
      rl.close();

      const loggedIn = await driver.isLoggedIn(ctx);
      await ctx.persistSession();
      setConnectionStatus(
        shop.id,
        loggedIn ? 'ok' : 'error',
        loggedIn ? 'Session ueber den Login-Assistenten gespeichert.' : 'Anmeldung nicht erkannt.',
      );
      console.log(
        loggedIn
          ? 'Session gespeichert. Kuenftige Laeufe brauchen keinen Login mehr.'
          : 'Achtung: Die Anmeldung wurde nicht erkannt. Session wurde trotzdem gesichert.',
      );
    },
  ).catch((error: unknown) => {
    console.error(`Fehler: ${errorMessage(error)}`);
  });

  await closeBrowser();
}

void main();
