/**
 * Prueft die Browser-Infrastruktur, die dm und REWE gemeinsam nutzen:
 * Cookie-Session zwischen Seite und HTTP-Client, Speichern und
 * Wiederverwenden des Storage-State.
 *
 * Uebersprungen, wenn kein Chromium installiert ist.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const workDir = mkdtempSync(path.join(tmpdir(), 'autohouse-browser-'));
process.env.DATABASE_FILE = path.join(workDir, 'browser.db');
process.env.ARTIFACT_DIR = path.join(workDir, 'runs');
process.env.STATE_DIR = path.join(workDir, 'state');
process.env.ENCRYPTION_KEY = '33'.repeat(32);
process.env.SCHEDULER_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';

const { db, closeDb } = await import('../src/db/index.ts');
const { createUser } = await import('../src/db/repo/users.ts');
const { createShop, getSessionState } = await import('../src/db/repo/shops.ts');
const { withDriverContext } = await import('../src/automation/context.ts');
const { closeBrowser, createSession } = await import('../src/automation/browser.ts');
const { requireBrowser } = await import('../src/automation/types.ts');

/** Kleiner Shop-Ersatz: setzt ein Cookie und liefert JSON nur mit Cookie aus. */
const server = http.createServer((req, res) => {
  if (req.url === '/login') {
    res.setHeader('set-cookie', 'shop_session=abc123; Path=/');
    res.end('<html><body><h1>Angemeldet</h1></body></html>');
    return;
  }
  if (req.url === '/api/cart') {
    if ((req.headers.cookie ?? '').includes('shop_session=abc123')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ totalPrice: 12.5, lineItems: [] }));
    } else {
      res.statusCode = 401;
      res.end('{"error":"kein Cookie"}');
    }
    return;
  }
  res.end('<html><body>Startseite</body></html>');
});

let base = '';
let chromiumAvailable = true;

test.before(async () => {
  server.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const session = await createSession({});
    await session.close();
  } catch {
    chromiumAvailable = false;
  }
});

test.after(async () => {
  await closeBrowser();
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

test('HTTP-Client teilt die Cookies der Seite und der Storage-State wird gesichert', async (t) => {
  if (!chromiumAvailable) {
    t.skip('Chromium ist nicht installiert (npx playwright install chromium).');
    return;
  }
  db();
  const user = createUser('browser@example.invalid', 'ein-langes-passwort');
  // Der Demo-Treiber braucht keinen Browser – fuer diesen Test wird der
  // REWE-Treiber nur als Traeger genutzt, angesprochen wird der lokale Server.
  const shop = createShop(user.id, { provider: 'rewe', name: 'Testshop', postalCode: '20095' });

  await withDriverContext({ shop, dryRun: true }, async (_driver, ctx) => {
    const { page, api } = requireBrowser(ctx);

    const before = await api.get(`${base}/api/cart`, { failOnStatusCode: false });
    assert.equal(before.status(), 401, 'ohne Login kein Zugriff');

    await page.goto(`${base}/login`);

    const after = await api.get(`${base}/api/cart`, { failOnStatusCode: false });
    assert.equal(after.status(), 200, 'nach dem Login teilt der HTTP-Client das Cookie');
    assert.deepEqual(await after.json(), { totalPrice: 12.5, lineItems: [] });

    await ctx.persistSession();
  });

  const stored = getSessionState(shop.id) as { cookies: Array<{ name: string }> } | null;
  assert.ok(stored, 'Session wurde verschluesselt gespeichert');
  assert.ok(
    stored.cookies.some((cookie) => cookie.name === 'shop_session'),
    'das Shop-Cookie steckt im gespeicherten Storage-State',
  );

  // Zweiter Lauf: gespeicherte Session wird wiederverwendet, kein Login noetig.
  await withDriverContext({ shop, dryRun: true }, async (_driver, ctx) => {
    const { api } = requireBrowser(ctx);
    const response = await api.get(`${base}/api/cart`, { failOnStatusCode: false });
    assert.equal(response.status(), 200, 'die wiederhergestellte Session gilt weiter');
  });
});
