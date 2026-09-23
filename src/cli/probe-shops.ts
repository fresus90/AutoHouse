/**
 * Machbarkeitspruefung fuer Onlineshops – ohne dass ein Shop angelegt sein muss.
 *
 * Oeffnet Start- und Anmeldeseite, erkennt vorgeschaltete Pruefungen der
 * Bot-Erkennung und sucht die Anmeldemaske. Daraus entsteht je Shop eine
 * Einschaetzung, ob AutoHouse dort ueberhaupt ansetzen kann.
 *
 *   npm run shops:probe
 *   npm run shops:probe -- --only knuspr,dm
 *   npm run shops:probe -- --url https://www.beispiel.de --login /login
 *
 * Es werden nur oeffentliche Seiten geoeffnet: keine Anmeldung, keine
 * Bestellung, keine Zugangsdaten.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeBrowser, createSession } from '../automation/browser.js';
import {
  describePage,
  detectBotChallenge,
  dismissConsentBanner,
  errorMessage,
  findLoginFields,
  waitForLoginForm,
  waitOutBotChallenge,
} from '../automation/util.js';
import { config } from '../config.js';
import { parseArgs } from './args.js';

interface Candidate {
  key: string;
  name: string;
  base: string;
  login: string;
  /** Was der Shop liefert – hilft beim Einordnen des Ergebnisses. */
  note: string;
}

/**
 * Auswahl: liefert Lebensmittel oder Drogerieartikel nach Deutschland und hat
 * einen Webshop. Reine App-Anbieter sind mit aufgefuehrt, damit die Pruefung
 * das selbst zeigt statt es zu behaupten.
 */
const CANDIDATES: Candidate[] = [
  { key: 'knuspr', name: 'Knuspr', base: 'https://www.knuspr.de', login: '/anmeldung', note: 'Lebensmittel-Lieferdienst (Rohlik), u. a. Muenchen und Berlin' },
  { key: 'picnic', name: 'Picnic', base: 'https://picnic.app', login: '/de/login', note: 'Lebensmittel-Lieferdienst; stark app-zentriert – Pruefung zeigt, ob es einen Webshop gibt' },
  { key: 'dm', name: 'dm', base: 'https://www.dm.de', login: '/login', note: 'Drogerie, Paketversand' },
  { key: 'rossmann', name: 'Rossmann', base: 'https://www.rossmann.de', login: '/de/login', note: 'Drogerie, Paketversand' },
  { key: 'mueller', name: 'Mueller', base: 'https://www.mueller.de', login: '/login', note: 'Drogerie, Paketversand' },
  { key: 'flaschenpost', name: 'Flaschenpost', base: 'https://www.flaschenpost.de', login: '/login', note: 'Getraenke, Lieferung am selben Tag' },
  { key: 'bringmeister', name: 'Bringmeister', base: 'https://www.bringmeister.de', login: '/login', note: 'Lebensmittel-Lieferdienst, Berlin und Muenchen' },
  { key: 'mytime', name: 'myTime', base: 'https://www.mytime.de', login: '/login', note: 'Lebensmittel per Paketversand, bundesweit' },
  { key: 'edeka24', name: 'Edeka24', base: 'https://www.edeka24.de', login: '/login', note: 'Haltbare Lebensmittel per Paketversand' },
  { key: 'amazonfresh', name: 'Amazon Fresh', base: 'https://www.amazon.de', login: '/ap/signin', note: 'Lebensmittel in Ballungsraeumen; bekannt fuer strenge Bot-Erkennung' },
  { key: 'rewe', name: 'REWE Lieferservice', base: 'https://shop.rewe.de', login: '/mydata/login', note: 'bereits geprueft: Cloudflare Turnstile' },
];

/** Zustimmungsschaltflaechen der gaengigen Consent-Werkzeuge. */
const CONSENT = [
  '#uc-btn-accept-banner',
  'button[data-testid="uc-accept-all-button"]',
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  'button[data-dmid="button-accept-all"]',
  'button:has-text("Alle akzeptieren")',
  'button:has-text("Alle Cookies akzeptieren")',
  'button:has-text("Akzeptieren")',
  'button:has-text("Einverstanden")',
  'button:has-text("Zustimmen")',
];

type Verdict = 'aussichtsreich' | 'pruefung' | 'unklar' | 'nicht erreichbar';

interface Result {
  candidate: Candidate;
  startTitle: string;
  startChallenge: string | null;
  loginUrl: string;
  loginTitle: string;
  loginChallenge: string | null;
  hasLoginForm: boolean;
  fieldCount: number;
  verdict: Verdict;
  detail: string;
}

const SYMBOL: Record<Verdict, string> = {
  aussichtsreich: '+',
  pruefung: 'x',
  unklar: '?',
  'nicht erreichbar': '-',
};

async function probe(candidate: Candidate, outDir: string): Promise<Result> {
  const session = await createSession({});
  const { page } = session;
  const result: Result = {
    candidate,
    startTitle: '',
    startChallenge: null,
    loginUrl: '',
    loginTitle: '',
    loginChallenge: null,
    hasLoginForm: false,
    fieldCount: 0,
    verdict: 'nicht erreichbar',
    detail: '',
  };

  try {
    await page.goto(candidate.base, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const start = await waitOutBotChallenge(page, 15_000);
    result.startTitle = await page.title().catch(() => '');
    if (!start.passed && start.challenge) {
      result.startChallenge = `${start.challenge.label}${start.challenge.vendor ? ` (${start.challenge.vendor})` : ''}`;
    }
    await dismissConsentBanner(page, CONSENT);

    await page
      .goto(`${candidate.base}${candidate.login}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch(() => undefined);
    const login = await waitOutBotChallenge(page, 15_000);
    await dismissConsentBanner(page, CONSENT);
    await waitForLoginForm(page, 8000);

    result.loginUrl = page.url();
    result.loginTitle = await page.title().catch(() => '');
    const stillChallenged = await detectBotChallenge(page);
    if (!login.passed && login.challenge) {
      result.loginChallenge = `${login.challenge.label}${login.challenge.vendor ? ` (${login.challenge.vendor})` : ''}`;
    } else if (stillChallenged) {
      result.loginChallenge = `${stillChallenged.label}${stillChallenged.vendor ? ` (${stillChallenged.vendor})` : ''}`;
    }

    const fields = await findLoginFields(page);
    const report = await describePage(page, 15);
    result.fieldCount = report.inputs.length;
    result.hasLoginForm = Boolean(fields.user);

    writeFileSync(
      path.join(outDir, `${candidate.key}.json`),
      JSON.stringify({ ...result, inputs: report.inputs, buttons: report.buttons }, null, 2),
      'utf8',
    );
    await page
      .screenshot({ path: path.join(outDir, `${candidate.key}.png`) })
      .catch(() => undefined);

    if (result.loginChallenge || result.startChallenge) {
      result.verdict = 'pruefung';
      result.detail = `Pruefung vorgeschaltet: ${result.loginChallenge ?? result.startChallenge}`;
    } else if (result.hasLoginForm) {
      result.verdict = 'aussichtsreich';
      result.detail = `Anmeldemaske gefunden${fields.password ? '' : ' (mehrstufig)'}`;
    } else {
      result.verdict = 'unklar';
      result.detail = `Seite laedt, aber keine Anmeldemaske (${result.fieldCount} Eingabefelder)`;
    }
  } catch (error) {
    result.detail = errorMessage(error).split('\n')[0]!.slice(0, 90);
  } finally {
    await session.close();
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let list = CANDIDATES;
  const custom = args.get('url');
  if (custom) {
    list = [
      {
        key: 'eigen',
        name: custom,
        base: custom.replace(/\/$/, ''),
        login: args.get('login') ?? '/login',
        note: 'selbst angegeben',
      },
    ];
  } else if (args.get('only')) {
    const wanted = args.get('only')!.split(',').map((entry) => entry.trim().toLowerCase());
    list = CANDIDATES.filter((entry) => wanted.includes(entry.key));
  }

  const outDir = path.join(config.artifactDir, 'probe');
  mkdirSync(outDir, { recursive: true });

  console.log(`Pruefe ${list.length} Shops. Es wird nur geschaut, nicht angemeldet und nicht bestellt.\n`);

  const results: Result[] = [];
  for (const candidate of list) {
    // Erst pruefen, dann die Zeile ausgeben: Sonst schiebt sich die
    // Startmeldung des Browsers mitten hinein.
    const result = await probe(candidate, outDir);
    results.push(result);
    console.log(
      `  ${SYMBOL[result.verdict]} ${candidate.name.padEnd(20)} ${result.verdict.padEnd(16)} ${result.detail}`,
    );
  }

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('Ergebnis\n');
  for (const verdict of ['aussichtsreich', 'unklar', 'pruefung', 'nicht erreichbar'] as Verdict[]) {
    const group = results.filter((entry) => entry.verdict === verdict);
    if (group.length === 0) continue;
    console.log(`${SYMBOL[verdict]} ${verdict.toUpperCase()}`);
    for (const entry of group) {
      console.log(`   ${entry.candidate.name} – ${entry.candidate.note}`);
      if (entry.loginUrl && entry.loginUrl !== `${entry.candidate.base}${entry.candidate.login}`) {
        console.log(`      gelandet auf: ${entry.loginUrl}`);
      }
      if (entry.loginTitle) console.log(`      Titel: ${entry.loginTitle}`);
    }
    console.log('');
  }
  console.log(`Screenshots und Berichte: ${outDir}`);
  console.log('"aussichtsreich" heisst: die Anmeldemaske ist erreichbar. Ob Suche,');
  console.log('Warenkorb und Kasse mitspielen, zeigt erst ein Treiber fuer den Shop.');

  await closeBrowser();
}

void main();
