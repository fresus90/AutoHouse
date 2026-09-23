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
  GENERIC_CONSENT,
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
  /** Moegliche Pfade der Anmeldeseite, der Reihe nach probiert. */
  login: string[];
  /** Was der Shop liefert – hilft beim Einordnen des Ergebnisses. */
  note: string;
}

/**
 * Auswahl: liefert Lebensmittel oder Drogerieartikel nach Deutschland und hat
 * einen Webshop. Reine App-Anbieter sind mit aufgefuehrt, damit die Pruefung
 * das selbst zeigt statt es zu behaupten.
 */
const CANDIDATES: Candidate[] = [
  { key: 'knuspr', name: 'Knuspr', base: 'https://www.knuspr.de', login: ['/anmeldung', '/login', '/account/login'], note: 'Lebensmittel-Lieferdienst (Rohlik), u. a. Muenchen und Berlin' },
  { key: 'picnic', name: 'Picnic', base: 'https://picnic.app', login: ['/de/login', '/de', '/login'], note: 'Lebensmittel-Lieferdienst; stark app-zentriert' },
  { key: 'dm', name: 'dm', base: 'https://www.dm.de', login: ['/login', '/anmelden'], note: 'Drogerie, Paketversand' },
  { key: 'rossmann', name: 'Rossmann', base: 'https://www.rossmann.de', login: ['/de/login', '/de/kundenkonto/login'], note: 'Drogerie, Paketversand' },
  { key: 'mueller', name: 'Mueller', base: 'https://www.mueller.de', login: ['/mein-konto/', '/account/login/', '/login/'], note: 'Drogerie, Paketversand' },
  { key: 'flaschenpost', name: 'Flaschenpost', base: 'https://www.flaschenpost.de', login: ['/login', '/anmelden'], note: 'Getraenke, Lieferung am selben Tag' },
  { key: 'bringmeister', name: 'Bringmeister', base: 'https://www.bringmeister.de', login: ['/login', '/anmelden'], note: 'Lebensmittel-Lieferdienst, Berlin und Muenchen' },
  { key: 'mytime', name: 'myTime', base: 'https://www.mytime.de', login: ['/login', '/kundenkonto'], note: 'Lebensmittel per Paketversand, bundesweit' },
  { key: 'edeka24', name: 'Edeka24', base: 'https://www.edeka24.de', login: ['/login/', '/kundenkonto/', '/customer/account/login/'], note: 'Haltbare Lebensmittel per Paketversand' },
  { key: 'amazonfresh', name: 'Amazon Fresh', base: 'https://www.amazon.de', login: ['/ap/signin', '/gp/sign-in.html'], note: 'Lebensmittel in Ballungsraeumen; bekannt fuer strenge Bot-Erkennung' },
  { key: 'rewe', name: 'REWE Lieferservice', base: 'https://shop.rewe.de', login: ['/mydata/login', '/login'], note: 'Lebensmittel-Lieferdienst mit Zeitfenstern' },
];

/** Titel, an denen eine Fehler- oder 404-Seite zu erkennen ist. */
const ERROR_TITLE =
  /(nicht gefunden|not found|404|error|fehler|could not be satisfied|forbidden)/i;

const CONSENT = [...GENERIC_CONSENT];

type Verdict =
  | 'aussichtsreich'
  | 'captcha im formular'
  | 'pruefung'
  | 'pfad unbekannt'
  | 'unklar'
  | 'nicht erreichbar';

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
  'captcha im formular': '!',
  pruefung: 'x',
  'pfad unbekannt': '?',
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
    // --- Startseite ---------------------------------------------------------
    await page.goto(candidate.base, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const start = await waitOutBotChallenge(page, 15_000);
    result.startTitle = await page.title().catch(() => '');
    if (!start.passed && start.challenge) {
      result.startChallenge = `${start.challenge.label}${start.challenge.vendor ? ` (${start.challenge.vendor})` : ''}`;
    }
    await dismissConsentBanner(page, CONSENT);

    // --- Anmeldeseite, mehrere Pfade der Reihe nach -------------------------
    let errorPages = 0;
    for (const loginPath of candidate.login) {
      await page
        .goto(`${candidate.base}${loginPath}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        .catch(() => undefined);
      await waitOutBotChallenge(page, 15_000);
      await dismissConsentBanner(page, CONSENT);
      await waitForLoginForm(page, 8000);

      result.loginUrl = page.url();
      result.loginTitle = await page.title().catch(() => '');

      if (ERROR_TITLE.test(result.loginTitle)) {
        errorPages += 1;
        continue; // naechster Pfad
      }

      const fields = await findLoginFields(page);
      if (fields.user) {
        result.hasLoginForm = true;
        break;
      }
    }

    // --- Auswerten ----------------------------------------------------------
    const challenge = await detectBotChallenge(page);
    // Bei bekanntem Anbieter dessen Namen nehmen – der Seitentitel ist als
    // Bezeichnung einer Pruefung oft irrefuehrend ("Login | Shop").
    const challengeName = challenge
      ? challenge.vendor === 'cloudflare'
        ? 'Cloudflare Turnstile'
        : challenge.label
      : null;
    if (challenge) result.loginChallenge = challengeName;
    const report = await describePage(page, 15);
    result.fieldCount = report.inputs.length;

    writeFileSync(
      path.join(outDir, `${candidate.key}.json`),
      JSON.stringify({ ...result, inputs: report.inputs, buttons: report.buttons }, null, 2),
      'utf8',
    );
    await page.screenshot({ path: path.join(outDir, `${candidate.key}.png`) }).catch(() => undefined);

    // Eine Anmeldemaske neben einem Captcha-Widget ist etwas anderes als eine
    // Seite, die gar nicht erst ausgeliefert wird. Beides trug bisher
    // dieselbe Einstufung.
    if (result.hasLoginForm && result.loginChallenge) {
      result.verdict = 'captcha im formular';
      result.detail = `Anmeldemaske vorhanden, aber mit ${challengeName} abgesichert`;
    } else if (result.hasLoginForm) {
      result.verdict = 'aussichtsreich';
      result.detail = 'Anmeldemaske gefunden';
    } else if (result.loginChallenge) {
      result.verdict = 'pruefung';
      result.detail = `Seite wird nicht ausgeliefert: ${result.loginChallenge}`;
    } else if (errorPages === candidate.login.length) {
      result.verdict = 'pfad unbekannt';
      result.detail = `keiner der Pfade existiert (zuletzt "${result.loginTitle}")`;
    } else {
      result.verdict = 'unklar';
      result.detail = `Seite laedt, aber keine Anmeldemaske (${result.fieldCount} Eingabefelder)`;
    }

    // Die Startseite wird getrennt vermerkt: Eine Pruefung dort heisst nicht,
    // dass auch die Anmeldeseite blockiert ist.
    if (result.startChallenge) {
      result.detail += `; Startseite zeigte "${result.startChallenge}"`;
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
        login: [args.get('login') ?? '/login'],
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
  const order: Verdict[] = [
    'aussichtsreich',
    'captcha im formular',
    'unklar',
    'pfad unbekannt',
    'pruefung',
    'nicht erreichbar',
  ];
  for (const verdict of order) {
    const group = results.filter((entry) => entry.verdict === verdict);
    if (group.length === 0) continue;
    console.log(`${SYMBOL[verdict]} ${verdict.toUpperCase()}`);
    for (const entry of group) {
      console.log(`   ${entry.candidate.name} – ${entry.candidate.note}`);
      if (entry.loginUrl && !entry.candidate.login.some((p) => entry.loginUrl === `${entry.candidate.base}${p}`)) {
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
