import type { ShopCredentials } from '../../core/types.js';
import {
  requireBrowser,
  type CartLine,
  type CartState,
  type DriverContext,
  type LoginResult,
  type ProductCandidate,
  type ShopDriver,
} from '../types.js';
import {
  describePage,
  dismissConsentBanner,
  firstVisible,
  parsePriceToCents,
  typeLikeHuman,
} from '../util.js';
import { performLogin } from '../login.js';

/**
 * Knuspr (knuspr.de, Rohlik-Gruppe)
 *
 * Besonderheiten gegenueber dm und REWE:
 *
 * - Die Anmeldemaske ist ein Overlay hinter `<div aria-label="Konto">`,
 *   keine eigene Seite. Das oeffnet `performLogin` von selbst.
 * - Ohne gesetzte Lieferadresse raet Knuspr das Liefergebiet aus der
 *   IP-Adresse. Ein Server in Nuernberg bekommt so das Berliner Sortiment –
 *   mit falschen Preisen und Lieferzeiten. `ensureAddress` setzt sie.
 * - Preise kommen als Euro-Betraege (2.69). Ganze Betraege erscheinen im JSON
 *   ohne Nachkommastellen (39 statt 39.00), deshalb ueberall `'euros'`
 *   angeben – sonst werden aus 39 Euro Mindestbestellwert 39 Cent.
 *
 * Stand der Pruefung: Die Struktur der Warenkorb-Antwort ist gegen eine echte
 * Antwort abgesichert (siehe tests/knuspr.test.ts). Die Adressen der
 * Endpunkte sind noch nicht bestaetigt – mit
 * `npm run shop:inspect -- --url … --network` nachsehen und hier eintragen.
 */
export const KNUSPR = {
  baseUrl: 'https://www.knuspr.de',
  paths: {
    home: '/',
    search: '/suche',
  },
  api: {
    // TODO gegen die Live-Seite pruefen (--network), siehe docs/shops.md
    cart: '/services/frontend-service/v2/cart',
    cartItem: '/services/frontend-service/v2/cart',
    search: '/services/frontend-service/search-metadata',
  },
  selectors: {
    consent: [
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      'button:has-text("Alle akzeptieren")',
      'button:has-text("Akzeptieren")',
    ],
    accountTrigger: ['[aria-label="Konto"]'],
    loginEmail: ['input#email'],
    loginPassword: ['input#password'],
    captcha: ['iframe[src*="captcha"]', 'iframe[title*="hCaptcha"]'],
    addressTrigger: ['button:has-text("Adresse ändern")', 'button:has-text("Genaue Adresse eingeben")'],
    addressInput: ['input#fullAddress', 'input[name="fullAddress"]'],
    addressSave: ['button:has-text("Speichern")'],
    /** Kopfzeile: "Du hast 3 Stück für 12,40 € in deinem Warenkorb." */
    cartSummary: ['[aria-label^="Du hast"]'],
    productTile: ['[data-test="productCard"]', 'div.product-card', '[data-productid]'],
  },
} as const;

const url = (p: string): string => `${KNUSPR.baseUrl}${p}`;

export class KnusprDriver implements ShopDriver {
  readonly provider = 'knuspr' as const;
  readonly label = 'Knuspr';
  /**
   * Knuspr liefert in Zeitfenstern, der Endpunkt dafuer ist aber noch nicht
   * bestaetigt. Bis dahin bewusst aus: lieber keine Auswahl als eine
   * vorgetaeuschte.
   */
  readonly supportsDeliverySlots = false;
  readonly requiresBrowser = true;

  async prepare(ctx: DriverContext): Promise<void> {
    const { page } = requireBrowser(ctx);
    await page.goto(url(KNUSPR.paths.home), { waitUntil: 'domcontentloaded' });
    if (await dismissConsentBanner(page, [...KNUSPR.selectors.consent])) {
      ctx.log.debug('Consent-Banner bestaetigt.');
    }
    await this.ensureAddress(ctx);
  }

  /**
   * Lieferadresse setzen. Ohne sie zeigt Knuspr das Sortiment des Gebiets,
   * das es aus der IP-Adresse ableitet – auf einem Server also das falsche.
   */
  private async ensureAddress(ctx: DriverContext): Promise<void> {
    const { page } = requireBrowser(ctx);
    const address = ctx.shop.marketId?.trim();
    if (!address) {
      ctx.log.warn(
        'Keine Lieferadresse am Shop hinterlegt. Knuspr raet das Liefergebiet dann aus ' +
          'der IP-Adresse des Servers – Sortiment und Preise koennen falsch sein. ' +
          'Die Adresse im Feld "Markt-ID" des Shops eintragen, z. B. "Musterstraße 1, München".',
      );
      return;
    }

    const trigger = await firstVisible(page, [...KNUSPR.selectors.addressTrigger], 6000);
    if (!trigger) {
      ctx.log.warn('Schaltflaeche fuer die Adresseingabe nicht gefunden.');
      await ctx.capture('knuspr-ohne-adressknopf');
      return;
    }
    await page.locator(trigger).first().click().catch(() => undefined);
    await page.waitForTimeout(800);

    const input = await firstVisible(page, [...KNUSPR.selectors.addressInput], 6000);
    if (!input) {
      ctx.log.warn('Eingabefeld fuer die Adresse nicht gefunden.');
      await ctx.capture('knuspr-ohne-adressfeld');
      return;
    }

    ctx.log.info(`Setze Lieferadresse: ${address}`);
    await page.locator(input).first().fill('');
    await typeLikeHuman(page, input, address);
    // Die Vorschlagsliste braucht einen Moment; der erste Treffer wird genommen.
    await page.waitForTimeout(1500);
    await page.keyboard.press('ArrowDown').catch(() => undefined);
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForTimeout(800);

    const save = await firstVisible(page, [...KNUSPR.selectors.addressSave], 4000);
    if (save) {
      await page.locator(save).first().click().catch(() => undefined);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      ctx.log.info('Lieferadresse gespeichert.');
    } else {
      ctx.log.warn('Schaltflaeche "Speichern" nicht gefunden – Adresse moeglicherweise nicht uebernommen.');
      await ctx.capture('knuspr-adresse-ohne-speichern');
    }
  }

  async isLoggedIn(ctx: DriverContext): Promise<boolean> {
    const { page } = requireBrowser(ctx);
    // Angemeldet steht im Konto-Symbol der Name statt "Anmelden".
    const text = await page
      .locator(KNUSPR.selectors.accountTrigger.join(', '))
      .first()
      .textContent({ timeout: 2500 })
      .catch(() => null);
    if (text === null) return false;
    return !/anmelden|einloggen|login/i.test(text);
  }

  async login(ctx: DriverContext, credentials: ShopCredentials): Promise<LoginResult> {
    ctx.log.info('Melde bei Knuspr an.');
    // Die Maske liegt als Overlay auf der Startseite; performLogin oeffnet sie
    // ueber das Konto-Symbol.
    return performLogin(ctx, credentials, {
      urls: [url(KNUSPR.paths.home)],
      consent: [...KNUSPR.selectors.consent],
      captcha: [...KNUSPR.selectors.captcha],
      isLoggedIn: () => this.isLoggedIn(ctx),
      shopLabel: 'Knuspr',
    });
  }

  async searchProducts(ctx: DriverContext, query: string, limit = 20): Promise<ProductCandidate[]> {
    const { api } = requireBrowser(ctx);
    const params = new URLSearchParams({ search: query, limit: String(limit), companyId: '1' });
    const response = await api
      .get(`${url(KNUSPR.api.search)}?${params.toString()}`, {
        headers: { accept: 'application/json' },
        failOnStatusCode: false,
      })
      .catch(() => null);

    if (response?.ok()) {
      const payload = (await response.json().catch(() => null)) as unknown;
      const products = extractKnusprProducts(payload).slice(0, limit);
      if (products.length > 0) {
        ctx.log.debug(`Suche "${query}": ${products.length} Treffer ueber die API.`);
        return products;
      }
    }
    ctx.log.warn(
      `Knuspr-Produktsuche ueber die API nicht moeglich (Status ${response?.status() ?? 'n/a'}), ` +
        'weiche auf die Seite aus.',
    );
    return this.searchViaDom(ctx, query, limit);
  }

  private async searchViaDom(
    ctx: DriverContext,
    query: string,
    limit: number,
  ): Promise<ProductCandidate[]> {
    const { page } = requireBrowser(ctx);
    await page.goto(`${url(KNUSPR.paths.search)}?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
    });
    await dismissConsentBanner(page, [...KNUSPR.selectors.consent]);
    // Die Treffer kommen per JavaScript nach.
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(2500);

    const tiles = page.locator(KNUSPR.selectors.productTile.join(', '));
    const count = Math.min(await tiles.count(), limit);
    if (count === 0) {
      const report = await describePage(page).catch(() => null);
      if (report) {
        ctx.log.warn('Keine Produktkacheln gefunden. Wiederkehrende Bloecke der Seite:', report.repeated);
      }
      return [];
    }

    const results: ProductCandidate[] = [];
    for (let i = 0; i < count; i += 1) {
      const tile = tiles.nth(i);
      const externalId =
        (await tile.getAttribute('data-productid')) ?? (await tile.getAttribute('data-id'));
      const name = ((await tile.locator('a, h3, [data-test="productCardName"]').first().textContent()) ?? '')
        .trim();
      const priceText = ((await tile.locator('[data-test*="price" i], .price').first().textContent()) ?? '')
        .trim();
      if (!externalId || !name) continue;
      results.push({
        externalId,
        name,
        priceCents: parsePriceToCents(priceText),
        productUrl: `${KNUSPR.baseUrl}/${externalId}`,
        available: true,
      });
    }
    return results;
  }

  async getProduct(ctx: DriverContext, externalId: string): Promise<ProductCandidate | null> {
    const hits = await this.searchProducts(ctx, externalId, 5);
    return hits.find((hit) => hit.externalId === externalId) ?? hits[0] ?? null;
  }

  async clearCart(ctx: DriverContext): Promise<void> {
    const { api } = requireBrowser(ctx);
    const cart = await this.readCart(ctx);
    for (const line of cart.lines) {
      await api
        .delete(`${url(KNUSPR.api.cartItem)}/${encodeURIComponent(line.externalId)}`, {
          failOnStatusCode: false,
        })
        .catch(() => null);
    }
    ctx.log.info(`Warenkorb geleert (${cart.lines.length} Positionen).`);
  }

  async addToCart(ctx: DriverContext, externalId: string, quantity: number): Promise<CartLine | null> {
    const { api } = requireBrowser(ctx);
    const response = await api
      .post(url(KNUSPR.api.cartItem), {
        headers: { 'content-type': 'application/json' },
        data: { productId: Number(externalId) || externalId, quantity, source: 'true:search' },
        failOnStatusCode: false,
      })
      .catch(() => null);

    if (!response?.ok()) {
      ctx.log.warn(`Artikel ${externalId} konnte nicht in den Warenkorb gelegt werden.`, {
        status: response?.status() ?? null,
      });
      return null;
    }
    // Die Antwort ist der komplette Warenkorb – die passende Zeile heraussuchen.
    const payload = (await response.json().catch(() => null)) as unknown;
    const cart = normalizeKnusprCart(payload);
    return cart.lines.find((line) => line.externalId === String(externalId)) ?? null;
  }

  async readCart(ctx: DriverContext): Promise<CartState> {
    const { api, page } = requireBrowser(ctx);
    const response = await api
      .get(url(KNUSPR.api.cart), { headers: { accept: 'application/json' }, failOnStatusCode: false })
      .catch(() => null);

    if (response?.ok()) {
      const payload = (await response.json().catch(() => null)) as unknown;
      const cart = normalizeKnusprCart(payload);
      if (cart.lines.length > 0 || cart.totalCents > 0) return cart;
    }

    // Rueckfallweg: Die Kopfzeile nennt Stueckzahl und Summe.
    const summary = await page
      .locator(KNUSPR.selectors.cartSummary.join(', '))
      .first()
      .getAttribute('aria-label')
      .catch(() => null);
    const totalCents = parsePriceToCents(summary?.match(/für\s+([\d.,]+\s*€)/)?.[1] ?? null);
    ctx.log.warn('Warenkorb ueber die API nicht lesbar, nutze die Angabe aus der Kopfzeile.');
    return { lines: [], totalCents: totalCents ?? 0 };
  }

  async placeOrder(ctx: DriverContext): Promise<{ reference: string | null }> {
    // Bewusst nicht umgesetzt: Der Ablauf an der Kasse ist nicht geprueft, und
    // ein halb geratener Bestellabschluss ist das Letzte, was hier passieren
    // soll. Testlaeufe funktionieren vollstaendig.
    ctx.log.error('Der Bestellabschluss bei Knuspr ist noch nicht umgesetzt.');
    throw new Error(
      'Knuspr: Bestellabschluss noch nicht umgesetzt. Der Warenkorb ist gefuellt und kann ' +
        'von Hand abgeschickt werden. Zum Fertigstellen den Kassen-Ablauf mit ' +
        '"shop:inspect --network" aufzeichnen (siehe docs/shops.md).',
    );
  }
}

// ---------------------------------------------------------------------------
// Antwort-Normalisierung
//
// Knuspr verpackt alles in { status, messages, data }. Preise sind Euro-Betraege;
// ganze Betraege kommen ohne Nachkommastellen an (39 statt 39.00).
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Packt { status, messages, data } aus, akzeptiert aber auch rohe Daten. */
function unwrap(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  return asRecord(root['data']) ?? root;
}

export function normalizeKnusprCart(payload: unknown): CartState {
  const data = unwrap(payload);
  if (!data) return { lines: [], totalCents: 0 };

  // items ist ein Objekt, dessen Schluessel die Produktnummern sind.
  const rawItems = asRecord(data['items']);
  const lines: CartLine[] = Object.values(rawItems ?? {})
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) return null;
      const quantity = Number(item['quantity'] ?? 1) || 1;
      const unitPrice =
        parsePriceToCents(item['price'] as unknown, 'euros') ??
        parsePriceToCents(item['originalPricePerUnit'] as unknown, 'euros');
      const externalId = String(item['productId'] ?? item['id'] ?? '');
      if (!externalId) return null;
      return {
        externalId,
        label: String(item['productName'] ?? 'Artikel'),
        quantity,
        unitPriceCents: unitPrice,
        // "price" ist der Stueckpreis; die Gesamtsumme des Korbs kommt aus
        // totalPrice und ist fuer die Budgetpruefung massgeblich.
        totalCents: unitPrice !== null ? unitPrice * quantity : null,
      } satisfies CartLine;
    })
    .filter((line): line is CartLine => line !== null);

  const totalCents =
    parsePriceToCents(data['totalPrice'] as unknown, 'euros') ??
    lines.reduce((sum, line) => sum + (line.totalCents ?? 0), 0);

  const minimum =
    parsePriceToCents(data['minimalOrderPrice'] as unknown, 'euros') ??
    parsePriceToCents(data['minimalStandardOrderPrice'] as unknown, 'euros');

  return { lines, totalCents, minimumOrderCents: minimum };
}

export function extractKnusprProducts(payload: unknown): ProductCandidate[] {
  const data = unwrap(payload);
  if (!data) return [];

  const raw =
    (Array.isArray(data['products']) && data['products']) ||
    (Array.isArray(data['items']) && data['items']) ||
    (asRecord(data['items']) ? Object.values(asRecord(data['items'])!) : []) ||
    [];

  return (raw as unknown[])
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) return null;
      const externalId = String(item['productId'] ?? item['id'] ?? '');
      const name = String(item['productName'] ?? item['name'] ?? '').trim();
      if (!externalId || !name) return null;
      const baseLink = typeof item['baseLink'] === 'string' ? item['baseLink'] : null;
      const candidate: ProductCandidate = {
        externalId,
        name,
        brand: item['brand'] ? String(item['brand']) : null,
        grammage: item['textualAmount'] ? String(item['textualAmount']) : null,
        priceCents:
          parsePriceToCents(item['price'] as unknown, 'euros') ??
          parsePriceToCents(item['originalPricePerUnit'] as unknown, 'euros'),
        basePrice: null,
        imageUrl: item['imgPath'] ? `https://cdn.knuspr.de${String(item['imgPath'])}` : null,
        productUrl: baseLink ? `${KNUSPR.baseUrl}/${baseLink}` : `${KNUSPR.baseUrl}/${externalId}`,
        available: item['maxBasketAmountReason'] !== 'NOT_ALLOWED',
      };
      return candidate;
    })
    .filter((product): product is ProductCandidate => product !== null);
}
