import type { ShopCredentials } from '../core/types.js';
import { requireBrowser, type DriverContext, type LoginResult } from './types.js';
import {
  describePage,
  dismissConsentBanner,
  findLoginFields,
  findLoginIframe,
  firstVisible,
  typeLikeHuman,
} from './util.js';

/**
 * Fuehrt eine Anmeldemaske aus – ein- oder zweistufig.
 *
 * Der Ablauf ist bei dm und REWE derselbe, nur die Adressen und
 * Erfolgspruefungen unterscheiden sich. Deshalb liegt er hier und nicht
 * doppelt in den Treibern.
 */
export async function performLogin(
  ctx: DriverContext,
  credentials: ShopCredentials,
  options: {
    /** Adressen, unter denen die Anmeldung stehen koennte. */
    urls: string[];
    consent: string[];
    captcha: string[];
    /** Prueft, ob die Anmeldung geklappt hat. */
    isLoggedIn: () => Promise<boolean>;
    shopLabel: string;
  },
): Promise<LoginResult> {
  const { page } = requireBrowser(ctx);

  for (const target of options.urls) {
    await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await dismissConsentBanner(page, options.consent);

    if (await firstVisible(page, options.captcha, 1200)) {
      await ctx.capture('captcha');
      return {
        ok: false,
        needsManualAction: true,
        message:
          `${options.shopLabel} zeigt ein Captcha. Bitte einmalig ueber ` +
          '"npm run shop:login" im sichtbaren Browser anmelden.',
      };
    }

    let fields = await findLoginFields(page);
    if (!fields.user) continue;

    ctx.log.debug(
      `Anmeldemaske auf ${page.url()} gefunden ` +
        `(Benutzerfeld ${fields.user}, Passwortfeld ${fields.password ?? 'noch nicht sichtbar'}).`,
    );

    await typeLikeHuman(page, fields.user, credentials.username);

    // Zweistufig: erst die E-Mail abschicken, dann erscheint das Passwortfeld.
    if (!fields.password) {
      ctx.log.info('Mehrstufige Anmeldung – sende zuerst die E-Mail-Adresse.');
      if (fields.submit) await page.locator(fields.submit).first().click().catch(() => undefined);
      else await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(800);
      fields = await findLoginFields(page);
      if (!fields.password) {
        await ctx.capture('login-ohne-passwortfeld');
        const report = await describePage(page).catch(() => null);
        if (report) ctx.log.warn(`Seite "${report.title}" (${report.url})`, report.inputs);
        return {
          ok: false,
          message:
            'Nach der E-Mail-Adresse erschien kein Passwortfeld. ' +
            'Seitenaufbau mit "npm run shop:inspect" pruefen.',
        };
      }
    }

    await typeLikeHuman(page, fields.password, credentials.password);
    if (fields.submit) await page.locator(fields.submit).first().click().catch(() => undefined);
    else await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(1000);

    if (await options.isLoggedIn()) {
      await ctx.persistSession();
      ctx.log.info('Anmeldung erfolgreich.');
      return { ok: true };
    }

    await ctx.capture('login-fehlgeschlagen');
    const errorText = await page
      .locator('[role="alert"], .form-error, [data-testid*="error"]')
      .first()
      .textContent({ timeout: 1500 })
      .catch(() => null);
    return {
      ok: false,
      message: (errorText ?? '').trim() || 'Anmeldung fehlgeschlagen – Zugangsdaten pruefen.',
    };
  }

  // Keine der Adressen zeigte eine Anmeldemaske.
  await ctx.capture('login-formular-nicht-gefunden');
  const iframe = await findLoginIframe(page).catch(() => null);
  if (iframe) {
    return {
      ok: false,
      message:
        `Die Anmeldemaske steckt in einem eingebetteten Rahmen (${iframe}). ` +
        'Bitte einmalig ueber "npm run shop:login" im sichtbaren Browser anmelden.',
    };
  }
  const report = await describePage(page).catch(() => null);
  if (report) {
    ctx.log.warn(`Seite "${report.title}" (${report.url}) – gefundene Eingabefelder:`, report.inputs);
  }
  return {
    ok: false,
    message:
      'Anmeldemaske nicht gefunden. Mit "npm run shop:inspect --url <login-pfad>" ' +
      'nachsehen, wie die Seite heute aufgebaut ist (siehe docs/shops.md).',
  };
}
