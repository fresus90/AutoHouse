import type { Page } from 'playwright';

/**
 * "1,99 €", "€ 1.99", "1 099,00" -> Cent. Gibt null zurueck, wenn nichts passt.
 *
 * Bei Zahlen ist die Einheit nicht aus dem Wert ablesbar (ist `30` nun 30 Cent
 * oder 30 Euro?). Deshalb sagt `integersAre` es explizit: Standard ist "cents",
 * weil die meisten Shop-APIs ganzzahlige Cent-Betraege liefern; Felder wie
 * Mindestbestellwerte werden mit "euros" gelesen. Zahlen mit Nachkommastellen
 * sind immer Euro.
 */
export function parsePriceToCents(
  input: unknown,
  integersAre: 'cents' | 'euros' = 'cents',
): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    if (!Number.isInteger(input)) return Math.round(input * 100);
    return integersAre === 'euros' ? input * 100 : input;
  }
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return null;
  // Letztes Trennzeichen entscheidet ueber die Dezimalstelle.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalSep = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : '';
  let normalized = cleaned;
  if (decimalSep) {
    const thousandSep = decimalSep === ',' ? '.' : ',';
    normalized = cleaned.split(thousandSep).join('').replace(decimalSep, '.');
  } else {
    normalized = cleaned.split(',').join('').split('.').join('');
  }
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '–';
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

/**
 * Klickt den ersten passenden Zustimmungs-Button eines Consent-Layers.
 * Bewusst tolerant: fehlt der Banner, ist das kein Fehler.
 */
export async function dismissConsentBanner(page: Page, selectors: string[]): Promise<boolean> {
  // Consent-Werkzeuge rendern haeufig in einem eingebetteten Rahmen, deshalb
  // werden alle Rahmen der Seite durchgesehen, nicht nur der Hauptrahmen.
  for (const frame of [page.mainFrame(), ...page.frames()]) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      try {
        if (await locator.isVisible({ timeout: 1000 })) {
          await locator.click({ timeout: 3000 });
          await page.waitForTimeout(400);
          return true;
        }
      } catch {
        // naechster Selektor
      }
    }
  }
  return false;
}

/** Erster Selektor, der sichtbar wird – oder null nach Ablauf des Zeitfensters. */
export async function firstVisible(
  page: Page,
  selectors: string[],
  timeoutMs = 5000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        if (await page.locator(selector).first().isVisible({ timeout: 250 })) return selector;
      } catch {
        // weiter
      }
    }
    await page.waitForTimeout(200);
  }
  return null;
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { attempts?: number; delayMs?: number; onRetry?: (error: unknown, attempt: number) => void } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      options.onRetry?.(error, attempt);
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Fehlermeldung robust in Text verwandeln. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Tippt mit zufaelligen Pausen – deutlich unauffaelliger als fill(). */
export async function typeLikeHuman(page: Page, selector: string, value: string): Promise<void> {
  const field = page.locator(selector).first();
  await field.click();
  for (const char of value) {
    await field.type(char, { delay: 40 + Math.random() * 80 });
  }
}

/**
 * Sucht das Eingabefeld fuer die Postleitzahl und gibt einen Selektor zurueck.
 *
 * Erst die bekannten Selektoren; findet keiner etwas, werden alle sichtbaren
 * Eingabefelder anhand von Beschriftung, Platzhalter, Name und Feldlaenge
 * geprueft. Der Treffer wird markiert, damit ein stabiler Selektor
 * zurueckgegeben werden kann. Das ueberlebt die meisten Umbauten des Shops,
 * ohne dass jemand Selektoren nachtragen muss.
 */
export async function findPostalCodeInput(
  page: Page,
  knownSelectors: string[],
): Promise<string | null> {
  const known = await firstVisible(page, knownSelectors, 6000);
  if (known) return known;

  const marker = 'data-autohouse-plz';
  const found = await page
    .evaluate((attribute) => {
      const hints = /(plz|postleit|zip|postal)/i;
      const inputs = Array.from(document.querySelectorAll('input'));
      const visible = inputs.filter((input) => {
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        const usable = ['text', 'tel', 'number', 'search', ''].includes(input.type);
        return usable && rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden';
      });

      const describe = (input: HTMLInputElement): string =>
        [
          input.name,
          input.id,
          input.placeholder,
          input.getAttribute('aria-label') ?? '',
          input.labels?.[0]?.textContent ?? '',
          input.closest('label')?.textContent ?? '',
        ].join(' ');

      const match =
        visible.find((input) => hints.test(describe(input))) ??
        visible.find(
          (input) => input.maxLength === 5 || input.getAttribute('inputmode') === 'numeric',
        ) ??
        (visible.length === 1 ? visible[0] : undefined);

      if (!match) return false;
      match.setAttribute(attribute, '1');
      return true;
    }, marker)
    .catch(() => false);

  return found ? `[${marker}="1"]` : null;
}

/**
 * Kurzbericht ueber die Bedienelemente einer Seite – die Grundlage, um
 * Selektoren nachzuziehen, wenn ein Shop sein Frontend umgebaut hat.
 */
export interface PageReport {
  url: string;
  title: string;
  inputs: Array<Record<string, string>>;
  buttons: Array<Record<string, string>>;
}

export async function describePage(page: Page, limit = 25): Promise<PageReport> {
  const collected = await page.evaluate((max) => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 4 && rect.height > 4 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const clean = (value: string | null | undefined): string =>
      (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const attrs = (element: Element, names: string[]): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const name of names) {
        const value = clean(element.getAttribute(name));
        if (value) out[name] = value;
      }
      return out;
    };

    const inputs = Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(visible)
      .slice(0, max)
      .map((element): Record<string, string> => ({
        tag: element.tagName.toLowerCase(),
        ...attrs(element, [
          'type', 'id', 'name', 'placeholder', 'aria-label', 'inputmode',
          'maxlength', 'data-testid', 'autocomplete',
        ]),
      }));

    const buttons = Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
      .filter(visible)
      .map((element): Record<string, string> => ({
        tag: element.tagName.toLowerCase(),
        text: clean(element.textContent),
        ...attrs(element, ['id', 'name', 'data-testid', 'aria-label', 'href']),
      }))
      .filter((entry) => entry['text'] || entry['data-testid'])
      .slice(0, max);

    return { title: document.title, inputs, buttons };
  }, limit);

  return { url: page.url(), title: collected.title, inputs: collected.inputs, buttons: collected.buttons };
}

export interface LoginFields {
  /** Selektor des Benutzer-/E-Mail-Feldes. */
  user: string | null;
  /** Selektor des Passwortfeldes; null bei mehrstufigen Anmeldungen. */
  password: string | null;
  /** Selektor der Absende-Schaltflaeche. */
  submit: string | null;
}

/**
 * Sucht die Felder einer Anmeldemaske.
 *
 * Anker ist `input[type="password"]` – das ueberlebt Umbauten deutlich besser
 * als Klassennamen oder data-Attribute, weil Browser und Passwortmanager
 * darauf angewiesen sind. Das Benutzerfeld ist das letzte Textfeld davor, die
 * Schaltflaeche der Absende-Knopf desselben Formulars.
 *
 * Fehlt das Passwortfeld, ist die Anmeldung meist zweistufig (erst E-Mail,
 * dann Passwort). Dann kommt `password: null` zurueck und der Aufrufer
 * schickt zuerst die E-Mail ab.
 */
export async function findLoginFields(page: Page): Promise<LoginFields> {
  const found = await page
    .evaluate(() => {
      const mark = (element: Element | null | undefined, name: string): string | null => {
        if (!element) return null;
        element.setAttribute(`data-autohouse-${name}`, '1');
        return `[data-autohouse-${name}="1"]`;
      };
      const isVisible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 20 &&
          rect.height > 8 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      };

      const all = Array.from(document.querySelectorAll('input'));
      const password = all.find((input) => input.type === 'password' && isVisible(input));

      const textLike = all.filter(
        (input) => ['email', 'text', 'tel'].includes(input.type) && isVisible(input),
      );
      const userHints = /(mail|user|login|benutzer|kunde)/i;
      const describe = (input: HTMLInputElement): string =>
        [
          input.name,
          input.id,
          input.placeholder,
          input.type,
          input.autocomplete,
          input.getAttribute('aria-label') ?? '',
          input.labels?.[0]?.textContent ?? '',
        ].join(' ');

      const submitTexts = /(anmelden|einloggen|login|weiter|fortfahren|continue)/i;
      const loginButtonNearby = Array.from(
        document.querySelectorAll('button, input[type="submit"]'),
      )
        .filter(isVisible)
        .some(
          (element) =>
            submitTexts.test(element.textContent ?? '') ||
            submitTexts.test(element.getAttribute('value') ?? ''),
        );

      let user: HTMLInputElement | undefined;
      if (password) {
        // Ein Passwortfeld ist starker Beleg fuer eine Anmeldemaske: Dann darf
        // das letzte Textfeld davor genommen werden.
        const before = textLike.filter(
          (input) =>
            input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
        user = before.at(-1) ?? textLike[0];
      } else {
        // Ohne Passwortfeld ist Vorsicht geboten: Sonst gilt das Suchfeld
        // einer Startseite als Anmeldemaske. Es braucht einen echten Hinweis.
        user =
          textLike.find((input) => input.type === 'email') ??
          textLike.find(
            (input) =>
              userHints.test(describe(input)) ||
              ['username', 'email'].includes(input.autocomplete),
          ) ??
          (loginButtonNearby && textLike.length === 1 ? textLike[0] : undefined);
      }

      const form = (password ?? user)?.closest('form');
      const candidates = Array.from(
        (form ?? document).querySelectorAll('button, input[type="submit"]'),
      ).filter(isVisible);
      const submit =
        candidates.find((element) => element.getAttribute('type') === 'submit') ??
        candidates.find((element) => submitTexts.test(element.textContent ?? '')) ??
        candidates.find((element) => submitTexts.test(element.getAttribute('value') ?? '')) ??
        candidates[0];

      return {
        user: mark(user, 'user'),
        password: mark(password, 'pass'),
        submit: mark(submit, 'submit'),
      };
    })
    .catch(() => ({ user: null, password: null, submit: null }));

  return found;
}

/**
 * Prueft, ob ein Passwortfeld in einem eingebetteten Rahmen steckt – das
 * kommt bei ausgelagerten Anmeldediensten vor und erklaert, warum auf der
 * Hauptseite nichts zu finden ist.
 */
export async function findLoginIframe(page: Page): Promise<string | null> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const hasPassword = await frame
      .locator('input[type="password"]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (hasPassword) return frame.url();
  }
  return null;
}

/**
 * Wartet darauf, dass eine Anmeldemaske sichtbar wird.
 *
 * Shops rendern ihre Formulare heute per JavaScript nach; direkt nach
 * `domcontentloaded` ist die Seite oft noch leer. Fehlt danach immer noch
 * ein Eingabefeld, wird ein sichtbarer Anmelden-Knopf angeklickt – manche
 * Shops oeffnen die Maske erst als Overlay.
 */
export async function waitForLoginForm(page: Page, timeoutMs = 10_000): Promise<boolean> {
  const anyField = 'input[type="password"], input[type="email"], input[type="text"], input[type="tel"]';

  const appeared = await page
    .locator(anyField)
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (appeared) return true;

  // Zweiter Versuch: Maske per Knopfdruck oeffnen.
  const triggers = [
    'button:has-text("Anmelden")',
    'a:has-text("Anmelden")',
    'button:has-text("Einloggen")',
    'a:has-text("Einloggen")',
    'button:has-text("Login")',
    '[data-testid*="login" i]',
  ];
  const trigger = await firstVisible(page, triggers, 2500);
  if (!trigger) return false;

  await page.locator(trigger).first().click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(700);
  return page
    .locator(anyField)
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
}

/** Ergebnis der Pruefseiten-Erkennung. */
export interface BotChallenge {
  /** Beschriftung der Seite, z. B. "Nur einen Moment…". */
  label: string;
  /** Erkannter Anbieter, wenn eindeutig. */
  vendor: 'cloudflare' | null;
}

/**
 * Erkennt eine vorgeschaltete Pruefseite der Bot-Erkennung.
 *
 * Zuverlaessiger als die Beschriftung ist der eingebundene Pruefdienst: Ein
 * Rahmen von challenges.cloudflare.com oder ein Skript unter
 * /cdn-cgi/challenge-platform/ benennt den Anbieter eindeutig. Zusaetzlich
 * werden die gaengigen Titel erkannt ("Nur einen Moment…", "Just a moment").
 */
export async function detectBotChallenge(page: Page): Promise<BotChallenge | null> {
  const marker =
    /(nur einen moment|einen augenblick|just a moment|checking your browser|attention required|access denied|zugriff verweigert|bitte best[äa]tigen sie|verify you are human|sind sie ein mensch)/i;

  const found = await page
    .evaluate(() => {
      const srcs = Array.from(document.querySelectorAll('iframe[src], script[src]')).map(
        (element) => element.getAttribute('src') ?? '',
      );
      return {
        title: document.title ?? '',
        text: (document.body?.innerText ?? '').slice(0, 400),
        cloudflare: srcs.some((src) =>
          /challenges\.cloudflare\.com|\/cdn-cgi\/challenge-platform\/|turnstile/i.test(src),
        ),
      };
    })
    .catch(() => null);
  if (!found) return null;

  const label =
    found.title.trim() ||
    (marker.test(found.text) ? found.text.split('\n')[0]!.trim() : '') ||
    'Pruefseite';

  if (found.cloudflare) return { label, vendor: 'cloudflare' };
  if (marker.test(found.title) || marker.test(found.text)) return { label, vendor: null };

  // Bewusst keine Faustregel ueber "die Seite wirkt leer": Eine Maske, die
  // sich erst auf Knopfdruck oeffnet, sieht genauso aus.
  return null;
}

/**
 * Wartet darauf, dass eine Pruefseite von selbst weiterleitet.
 *
 * Viele Pruefungen loesen sich nach ein paar Sekunden auf, sobald das
 * JavaScript durchgelaufen ist – dann geht es normal weiter. Bleibt die Seite
 * stehen, kommt die erkannte Beschriftung zurueck, damit der Aufrufer
 * verstaendlich melden kann, woran es liegt.
 */
export async function waitOutBotChallenge(
  page: Page,
  timeoutMs = 30_000,
): Promise<{ passed: boolean; challenge: BotChallenge | null }> {
  const challenge = await detectBotChallenge(page);
  if (!challenge) return { passed: true, challenge: null };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    const still = await detectBotChallenge(page);
    if (!still) return { passed: true, challenge };
  }
  return { passed: false, challenge };
}

/** Erklaert verstaendlich, was eine stehengebliebene Pruefseite bedeutet. */
export function explainBotChallenge(challenge: BotChallenge, url: string, shopLabel: string): string {
  const head = `${shopLabel} liefert die Seite nicht aus, sondern eine Pruefung der Bot-Erkennung ("${challenge.label}", ${url}).`;

  if (challenge.vendor === 'cloudflare') {
    return (
      `${head} Es handelt sich um Cloudflare Turnstile. ` +
      'Die Freigabe wird im Cookie cf_clearance abgelegt und ist an die IP-Adresse gebunden – ' +
      'eine von einem anderen Anschluss uebertragene Session hilft hier also nicht. ' +
      'Server-Adressen aus Rechenzentren werden praktisch immer geprueft. ' +
      'Realistisch bleibt, AutoHouse von einem privaten Anschluss aus zu betreiben ' +
      '(siehe docs/shops.md, Abschnitt "Bot-Erkennung").'
    );
  }
  return (
    `${head} Das ist keine Frage der Selektoren: Adressen aus Rechenzentren werden dabei ` +
    'haeufig abgewiesen. Abhilfe: einmal von einem privaten Anschluss anmelden und die ' +
    'Session uebertragen (docs/hosting.md, Abschnitt 8) oder AutoHouse zuhause betreiben.'
  );
}
