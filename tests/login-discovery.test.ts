/**
 * Prueft die Erkennung von Anmeldemasken und den gemeinsamen Login-Ablauf.
 * Laeuft gegen lokal erzeugte Seiten und einen lokalen Server, nicht gegen
 * dm oder REWE.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const workDir = mkdtempSync(path.join(tmpdir(), 'autohouse-login-'));
process.env.DATABASE_FILE = path.join(workDir, 'login.db');
process.env.ARTIFACT_DIR = path.join(workDir, 'runs');
process.env.STATE_DIR = path.join(workDir, 'state');
process.env.ENCRYPTION_KEY = '55'.repeat(32);
process.env.SCHEDULER_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';

const { findLoginFields } = await import('../src/automation/util.ts');
const { performLogin } = await import('../src/automation/login.ts');
const { closeBrowser, createSession } = await import('../src/automation/browser.ts');
const { withDriverContext } = await import('../src/automation/context.ts');
const { requireBrowser } = await import('../src/automation/types.ts');
const { db, closeDb } = await import('../src/db/index.ts');
const { createUser } = await import('../src/db/repo/users.ts');
const { createShop } = await import('../src/db/repo/shops.ts');

let chromium = true;

test.before(async () => {
  try {
    const session = await createSession({});
    await session.close();
  } catch {
    chromium = false;
  }
});

test.after(async () => {
  await closeBrowser();
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

async function onPage<T>(html: string, fn: (page: never) => Promise<T>): Promise<T> {
  const session = await createSession({});
  try {
    await session.page.setContent(`<html lang="de"><body>${html}</body></html>`);
    return await fn(session.page as never);
  } finally {
    await session.close();
  }
}

test('Anmeldemaske wird ueber das Passwortfeld gefunden', async (t) => {
  if (!chromium) return t.skip('Chromium fehlt.');

  const klassisch = await onPage(
    `<form><input type="email" name="email"><input type="password" name="password">
     <button type="submit">Anmelden</button></form>`,
    (page) => findLoginFields(page as never),
  );
  assert.ok(klassisch.user && klassisch.password && klassisch.submit);

  const ohneNamen = await onPage(
    `<div><input class="a1" type="text"><input class="b2" type="password">
     <button class="c3">Einloggen</button></div>`,
    (page) => findLoginFields(page as never),
  );
  assert.ok(ohneNamen.user, 'Benutzerfeld auch ohne name/id');
  assert.ok(ohneNamen.password);
  assert.ok(ohneNamen.submit);

  // Ein Suchfeld im Kopfbereich darf nicht faelschlich als Benutzerfeld gelten.
  const mitSuche = await onPage(
    `<header><input type="search" name="suche" placeholder="Produkte suchen"></header>
     <form><input type="text" name="kundennummer"><input type="password" name="pw">
     <button type="submit">Anmelden</button></form>`,
    async (page) => {
      const fields = await findLoginFields(page as never);
      const name = await (page as never as {
        getAttribute: (s: string, a: string) => Promise<string | null>;
      }).getAttribute(fields.user!, 'name');
      return name;
    },
  );
  assert.equal(mitSuche, 'kundennummer', 'das Feld direkt vor dem Passwort gewinnt');
});

test('mehrstufige Anmeldung wird als solche erkannt', async (t) => {
  if (!chromium) return t.skip('Chromium fehlt.');
  const fields = await onPage(
    `<form><input type="email" name="email"><button type="submit">Weiter</button></form>`,
    (page) => findLoginFields(page as never),
  );
  assert.ok(fields.user);
  assert.equal(fields.password, null, 'kein Passwortfeld sichtbar');
  assert.ok(fields.submit);
});

test('unsichtbare Felder werden uebergangen', async (t) => {
  if (!chromium) return t.skip('Chromium fehlt.');
  const fields = await onPage(
    `<input type="password" style="display:none"><p>Nur Text</p>`,
    (page) => findLoginFields(page as never),
  );
  assert.equal(fields.password, null);
  assert.equal(fields.user, null);
});

// ---------------------------------------------------------------------------
// Vollstaendiger Ablauf gegen einen lokalen Shop-Ersatz
// ---------------------------------------------------------------------------

type Variante = 'einstufig' | 'zweistufig' | 'nachgeladen' | 'overlay' | 'gesperrt';

function fakeShop(variante: Variante): http.Server {
  return http.createServer((req, res) => {
    const url = req.url ?? '/';
    const angemeldet = (req.headers.cookie ?? '').includes('sess=1');

    if (url === '/api/session') {
      res.statusCode = angemeldet ? 200 : 401;
      res.end(angemeldet ? '{"ok":true}' : '{"error":"nein"}');
      return;
    }
    if (url.startsWith('/schritt2')) {
      res.setHeader('content-type', 'text/html');
      res.end(`<html><body><form action="/fertig">
        <input type="password" name="pw" class="zufall7">
        <button type="submit">Anmelden</button></form></body></html>`);
      return;
    }
    if (url.startsWith('/fertig')) {
      res.setHeader('set-cookie', 'sess=1; Path=/');
      res.setHeader('content-type', 'text/html');
      res.end('<html><body><h1>Angemeldet</h1></body></html>');
      return;
    }
    if (url.startsWith('/login')) {
      res.setHeader('content-type', 'text/html');
      const formular = `<form action="/fertig">
          <input type="email" name="mail" class="zufall3">
          <input type="password" name="pw" class="zufall7">
          <button type="submit">Anmelden</button></form>`;

      if (variante === 'zweistufig') {
        res.end(`<html><body><form action="/schritt2">
          <input type="email" name="mail" class="zufall3">
          <button type="submit">Weiter</button></form></body></html>`);
      } else if (variante === 'nachgeladen') {
        // Wie eine Single-Page-App: Das Formular entsteht erst per JavaScript.
        res.end(`<html><body><div id="app"></div><script>
          setTimeout(function () {
            document.getElementById('app').innerHTML = ${JSON.stringify(formular)};
          }, 1200);
        </script></body></html>`);
      } else if (variante === 'overlay') {
        // Die Maske oeffnet sich erst auf Knopfdruck.
        res.end(`<html><body><button id="oeffnen">Anmelden</button>
          <div id="app"></div><script>
          document.getElementById('oeffnen').addEventListener('click', function () {
            document.getElementById('app').innerHTML = ${JSON.stringify(formular)};
          });
        </script></body></html>`);
      } else if (variante === 'gesperrt') {
        res.end('<html><head><title>Access Denied</title></head><body><p>Zugriff verweigert</p></body></html>');
      } else {
        res.end(`<html><body>${formular}</body></html>`);
      }
      return;
    }
    res.end('<html><body>Startseite</body></html>');
  });
}

async function runLogin(variante: Variante): Promise<{ ok: boolean; message?: string }> {
  const server = fakeShop(variante);
  server.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  db();
  const user = createUser(`login-${variante}-${Date.now()}@example.invalid`, 'ein-langes-passwort');
  const shop = createShop(user.id, { provider: 'rewe', name: 'Testshop' });

  try {
    return await withDriverContext({ shop, dryRun: true }, async (_driver, ctx) => {
      const { api } = requireBrowser(ctx);
      return performLogin(
        ctx,
        { username: 'kundin@example.invalid', password: 'geheim123' },
        {
          urls: [`${base}/login`],
          consent: [],
          captcha: [],
          shopLabel: 'Testshop',
          isLoggedIn: async () => {
            const response = await api
              .get(`${base}/api/session`, { failOnStatusCode: false })
              .catch(() => null);
            return response?.status() === 200;
          },
        },
      );
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('einstufige Anmeldung laeuft komplett durch', async (t) => {
  if (!chromium) return t.skip('Chromium fehlt.');
  const result = await runLogin('einstufig');
  assert.equal(result.ok, true, result.message ?? '');
});

test('zweistufige Anmeldung laeuft komplett durch', async (t) => {
  if (!chromium) return t.skip('Chromium fehlt.');
  const result = await runLogin('zweistufig');
  assert.equal(result.ok, true, result.message ?? '');
});

test('per JavaScript nachgeladenes Formular wird abgewartet', async (t) => {
  if (!chromium) return t.skip('Chromium fehlt.');
  const result = await runLogin('nachgeladen');
  assert.equal(result.ok, true, result.message ?? '');
});

test('Maske, die sich erst auf Knopfdruck oeffnet, wird geoeffnet', async (t) => {
  if (!chromium) return t.skip('Chromium fehlt.');
  const result = await runLogin('overlay');
  assert.equal(result.ok, true, result.message ?? '');
});

test('Sperrseite meldet Adresse und Titel zurueck', async (t) => {
  if (!chromium) return t.skip('Chromium fehlt.');
  const result = await runLogin('gesperrt');
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /Access Denied/, 'der Seitentitel steht in der Meldung');
  assert.match(result.message ?? '', /127\.0\.0\.1/, 'die tatsaechliche Adresse steht in der Meldung');
});
