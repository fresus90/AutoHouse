/**
 * Prueft, dass das Postleitzahl-Feld auch dann gefunden wird, wenn der Shop
 * seine Attribute umbenannt hat – und dass der Seitenbericht brauchbar ist.
 *
 * Laeuft gegen lokal erzeugte Seiten, nicht gegen dm oder REWE.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'autohouse-selectors-'));
process.env.DATABASE_FILE = path.join(workDir, 'sel.db');
process.env.ARTIFACT_DIR = path.join(workDir, 'runs');
process.env.STATE_DIR = path.join(workDir, 'state');
process.env.ENCRYPTION_KEY = '44'.repeat(32);
process.env.SCHEDULER_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';

const { describePage, findPostalCodeInput } = await import('../src/automation/util.ts');
const { closeBrowser, createSession } = await import('../src/automation/browser.ts');

/** Die Selektoren, die der REWE-Treiber zuerst probiert. */
const KNOWN = [
  'input[data-testid="marketsearch-input"]',
  'input[name="zipCode"]',
  'input[placeholder*="Postleitzahl" i]',
  'input[inputmode="numeric"][maxlength="5"]',
];

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
  rmSync(workDir, { recursive: true, force: true });
});

async function withPage<T>(html: string, fn: (page: never) => Promise<T>): Promise<T> {
  const session = await createSession({});
  try {
    await session.page.setContent(`<html lang="de"><body>${html}</body></html>`);
    return await fn(session.page as never);
  } finally {
    await session.close();
  }
}

const CASES: Array<[string, string, boolean]> = [
  [
    'bekannter Selektor',
    '<input data-testid="marketsearch-input" type="text">',
    true,
  ],
  [
    'unbekanntes Attribut, aber sprechender Platzhalter',
    '<input class="x7f2" type="text" placeholder="Postleitzahl eingeben">',
    true,
  ],
  [
    'nur aria-label',
    '<input class="a" type="text" aria-label="Ihre PLZ">',
    true,
  ],
  [
    'umschliessendes Label',
    '<label>Postleitzahl <input class="b" type="text"></label>',
    true,
  ],
  [
    'keinerlei Hinweis, aber fuenfstellig und numerisch',
    '<input class="c" type="text" maxlength="5" inputmode="numeric">',
    true,
  ],
  [
    'einziges Eingabefeld der Seite',
    '<input class="d" type="text">',
    true,
  ],
  [
    'mehrere Felder ohne Hinweis – bewusst kein Treffer',
    '<input class="e" type="text"><input class="f" type="text"><input class="g" type="text">',
    false,
  ],
  ['gar kein Eingabefeld', '<p>Nur Text</p>', false],
  [
    'verstecktes Feld wird uebergangen',
    '<input type="hidden" name="zipCode"><p>x</p>',
    false,
  ],
];

test('Postleitzahl-Feld wird auch nach einem Umbau gefunden', async (t) => {
  if (!chromium) {
    t.skip('Chromium ist nicht installiert.');
    return;
  }
  for (const [label, html, shouldFind] of CASES) {
    const selector = await withPage(html, (page) =>
      findPostalCodeInput(page as never, KNOWN),
    );
    assert.equal(
      selector !== null,
      shouldFind,
      `${label}: erwartet ${shouldFind ? 'Treffer' : 'kein Treffer'}, bekam ${selector}`,
    );
  }
});

test('gefundenes Feld laesst sich auch wirklich befuellen', async (t) => {
  if (!chromium) {
    t.skip('Chromium ist nicht installiert.');
    return;
  }
  const value = await withPage(
    '<div><input class="umbenannt" type="text" aria-label="Postleitzahl"></div>',
    async (page) => {
      const selector = await findPostalCodeInput(page as never, KNOWN);
      assert.ok(selector, 'Selektor gefunden');
      const locator = (page as never as { locator: (s: string) => { fill: (v: string) => Promise<void> } })
        .locator(selector);
      await locator.fill('81541');
      return (page as never as { inputValue: (s: string) => Promise<string> }).inputValue(selector);
    },
  );
  assert.equal(value, '81541');
});

test('Seitenbericht listet Felder und Schaltflaechen auf', async (t) => {
  if (!chromium) {
    t.skip('Chromium ist nicht installiert.');
    return;
  }
  const report = await withPage(
    `<input id="plz" name="zipCode" placeholder="PLZ" maxlength="5">
     <button data-testid="submit">Lieferservice waehlen</button>
     <a href="/hilfe">Hilfe</a>
     <input type="hidden" name="csrf">`,
    (page) => describePage(page as never, 20),
  );
  assert.equal(report.inputs.length, 1, 'versteckte Felder tauchen nicht auf');
  assert.equal(report.inputs[0]!['name'], 'zipCode');
  assert.equal(report.inputs[0]!['maxlength'], '5');
  const texts = report.buttons.map((b) => b['text']);
  assert.ok(texts.includes('Lieferservice waehlen'));
  assert.ok(texts.includes('Hilfe'));
});
