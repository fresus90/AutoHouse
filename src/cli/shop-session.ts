/**
 * Browser-Session eines Shops exportieren und importieren.
 *
 * Hintergrund: Der erste Login bei dm und REWE braucht oft einen sichtbaren
 * Browser (Captcha, Zwei-Faktor). Auf einem Server ohne Bildschirm geht das
 * nicht. Also: einmal auf dem eigenen Rechner anmelden, die Session
 * exportieren und auf dem Server importieren.
 *
 *   npm run shop:session -- --export shop_abc --out session.json
 *   npm run shop:session -- --import shop_xyz --file session.json
 *
 * ACHTUNG: Die Exportdatei enthaelt die Anmelde-Cookies des Shops im Klartext.
 * Sie ist so schuetzenswert wie das Passwort selbst – sicher uebertragen
 * (scp) und danach loeschen.
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { db } from '../db/index.js';
import { listUsers } from '../db/repo/users.js';
import {
  getSessionState,
  listShops,
  saveSessionState,
  setConnectionStatus,
} from '../db/repo/shops.js';
import { parseArgs } from './args.js';
import type { Shop } from '../core/types.js';

function findShop(shopId: string): Shop | undefined {
  return listUsers()
    .flatMap((user) => listShops(user.id))
    .find((shop) => shop.id === shopId);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  db();

  const exportId = args.get('export');
  const importId = args.get('import');

  if (!exportId && !importId) {
    console.log('Shops mit gespeicherter Session:');
    for (const user of listUsers()) {
      for (const shop of listShops(user.id)) {
        console.log(
          `  ${shop.id}  ${shop.provider.padEnd(5)} ${shop.name}` +
            `  [${shop.hasSession ? 'Session vorhanden' : 'keine Session'}]`,
        );
      }
    }
    console.log(
      '\nAufruf:\n' +
        '  npm run shop:session -- --export <shop-id> [--out <datei>]\n' +
        '  npm run shop:session -- --import <shop-id> --file <datei>',
    );
    return;
  }

  if (exportId) {
    const shop = findShop(exportId);
    if (!shop) {
      console.error(`Shop ${exportId} nicht gefunden.`);
      process.exit(1);
    }
    const state = getSessionState(shop.id);
    if (!state) {
      console.error(
        `Fuer "${shop.name}" ist keine (gueltige) Session gespeichert.\n` +
          'Zuerst anmelden: npm run shop:login -- --shop ' + shop.id,
      );
      process.exit(1);
    }
    const target = args.get('out') ?? `session-${shop.provider}.json`;
    writeFileSync(target, JSON.stringify(state, null, 2), 'utf8');
    chmodSync(target, 0o600);
    console.log(`Session von "${shop.name}" nach ${target} geschrieben.`);
    console.log('Die Datei enthaelt Anmelde-Cookies im Klartext – nach dem Import loeschen.');
    return;
  }

  const shop = findShop(importId!);
  if (!shop) {
    console.error(`Shop ${importId} nicht gefunden.`);
    process.exit(1);
  }
  const file = args.get('file');
  if (!file) {
    console.error('Bitte die Quelldatei angeben: --file <datei>');
    process.exit(1);
  }

  let state: unknown;
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Datei ${file} konnte nicht gelesen werden: ${(error as Error).message}`);
    process.exit(1);
  }
  const cookies = (state as { cookies?: unknown }).cookies;
  if (!Array.isArray(cookies)) {
    console.error('Die Datei sieht nicht wie ein Playwright-Storage-State aus (kein "cookies"-Feld).');
    process.exit(1);
  }

  saveSessionState(shop.id, state);
  setConnectionStatus(shop.id, 'unknown', 'Session importiert – bitte Verbindung testen.');
  console.log(`Session mit ${cookies.length} Cookies fuer "${shop.name}" importiert.`);
  console.log('Naechster Schritt: in der Oberflaeche unter "Shops" auf "Verbindung testen".');
}

main();
