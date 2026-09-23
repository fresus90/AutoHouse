import type { ShopCredentials } from '../../core/types.js';
import {
  requireBrowser,
  type CartLine,
  type CartState,
  type DeliverySlot,
  type DriverContext,
  type LoginResult,
  type ProductCandidate,
  type ShopDriver,
} from '../types.js';
import {
  describePage,
  dismissConsentBanner,
  findPostalCodeInput,
  firstVisible,
  parsePriceToCents,
  typeLikeHuman,
} from '../util.js';

/**
 * REWE Lieferservice (shop.rewe.de)
 *
 * Strategie: Der Browser stellt die Session her (Consent, Marktwahl, Login).
 * Danach laufen Suche, Warenkorb und Lieferzeitfenster ueber die JSON-Endpunkte
 * derselben Session. Nur wenn ein Endpunkt nicht antwortet, wird auf das DOM
 * zurueckgefallen.
 *
 * WICHTIG: Endpunkte und Selektoren sind bewusst hier oben gebuendelt. REWE
 * aendert beides regelmaessig – bei einem Fehler zuerst diese Tabelle gegen die
 * Live-Seite pruefen (siehe docs/shops.md, Abschnitt "Selektoren pflegen").
 */
export const REWE = {
  baseUrl: 'https://shop.rewe.de',
  paths: {
    home: '/',
    login: '/mydata/login',
    marketSelection: '/marktwahl',
    cart: '/checkout/cart',
    checkout: '/checkout',
  },
  api: {
    search: '/api/products',
    cart: '/api/cart',
    cartLineItems: '/api/cart/line-items',
    timeslots: '/api/timeslots',
    order: '/api/checkout/order',
  },
  selectors: {
    consent: [
      '#uc-btn-accept-banner',
      'button[data-testid="uc-accept-all-button"]',
      'button:has-text("Alle akzeptieren")',
      'button:has-text("Akzeptieren")',
    ],
    postalCodeInput: [
      'input[data-testid="marketsearch-input"]',
      'input[data-testid="zip-code-input"]',
      'input[name="zipCode"]',
      'input[name*="postal" i]',
      'input[id*="zip" i]',
      'input[id*="plz" i]',
      'input[placeholder*="Postleitzahl" i]',
      'input[placeholder*="PLZ" i]',
      'input[aria-label*="Postleitzahl" i]',
      'input[inputmode="numeric"][maxlength="5"]',
    ],
    deliveryServiceButton: [
      'button[data-testid="delivery-service-button"]',
      'a:has-text("Lieferservice")',
    ],
    loginEmail: ['input#email', 'input[name="email"]', 'input[type="email"]'],
    loginPassword: ['input#password', 'input[name="password"]', 'input[type="password"]'],
    loginSubmit: ['button[type="submit"]', 'button:has-text("Anmelden")'],
    loggedInMarker: [
      '[data-testid="user-menu"]',
      'a[href*="/mydata"]',
      'button[aria-label*="Mein Konto"]',
    ],
    loginError: ['[data-testid="login-error"]', '.form-error', '[role="alert"]'],
    captcha: ['iframe[src*="captcha"]', '#px-captcha', 'iframe[title*="hCaptcha"]'],
    placeOrderButton: [
      'button[data-testid="place-order-button"]',
      'button:has-text("Zahlungspflichtig bestellen")',
      'button:has-text("Kostenpflichtig bestellen")',
    ],
    orderReference: ['[data-testid="order-number"]', '.order-confirmation__number'],
  },
} as const;

const url = (p: string): string => `${REWE.baseUrl}${p}`;

export class ReweDriver implements ShopDriver {
  readonly provider = 'rewe' as const;
  readonly label = 'REWE Lieferservice';
  readonly supportsDeliverySlots = true;
  readonly requiresBrowser = true;

  async prepare(ctx: DriverContext): Promise<void> {
    const { page } = requireBrowser(ctx);
    await page.goto(url(REWE.paths.home), { waitUntil: 'domcontentloaded' });
    if (await dismissConsentBanner(page, [...REWE.selectors.consent])) {
      ctx.log.debug('Consent-Banner bestaetigt.');
    }
    await this.ensureMarket(ctx);
  }

  /**
   * Liefergebiet setzen – ohne Markt liefert die Suche keine Preise.
   *
   * Scheitert das, wird der Lauf nicht abgebrochen: Die Anmeldung laesst sich
   * trotzdem pruefen, und der Fehlschlag ist mit Screenshot und Seitenbericht
   * im Protokoll dokumentiert. Ein Bestelllauf ohne Markt findet schlicht
   * keine Artikel und endet sauber als "Aktion noetig".
   */
  private async ensureMarket(ctx: DriverContext): Promise<void> {
    const { page } = requireBrowser(ctx);
    if (!ctx.shop.postalCode) {
      ctx.log.warn('Keine Postleitzahl am Shop hinterlegt – REWE zeigt ggf. kein Sortiment.');
      return;
    }
    const alreadySet = await page
      .locator('[data-testid="market-info"], [data-testid="header-market"]')
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (alreadySet) {
      ctx.log.debug('Markt ist bereits gesetzt.');
      return;
    }

    ctx.log.info(`Setze Liefergebiet auf PLZ ${ctx.shop.postalCode}.`);

    // Mehrere Einstiege probieren – REWE hat die Marktwahl schon mehrfach
    // verschoben.
    let input: string | null = null;
    for (const path of [REWE.paths.marketSelection, REWE.paths.home]) {
      await page.goto(url(path), { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await dismissConsentBanner(page, [...REWE.selectors.consent]);
      input = await findPostalCodeInput(page, [...REWE.selectors.postalCodeInput]);
      if (input) {
        ctx.log.debug(`Eingabefeld gefunden auf ${path} (${input}).`);
        break;
      }
    }

    if (!input) {
      await ctx.capture('marktwahl-ohne-eingabefeld');
      const report = await describePage(page).catch(() => null);
      if (report) {
        ctx.log.warn(`Seite "${report.title}" (${report.url}) – gefundene Eingabefelder:`, report.inputs);
      }
      ctx.log.error(
        'Marktwahl: Eingabefeld fuer die Postleitzahl nicht gefunden. ' +
          'Seitenaufbau mit "npm run shop:inspect" pruefen (siehe docs/shops.md).',
      );
      return;
    }

    await typeLikeHuman(page, input, ctx.shop.postalCode);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const service = await firstVisible(page, [...REWE.selectors.deliveryServiceButton], 8000);
    if (service) {
      await page.locator(service).first().click();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      ctx.log.info('Lieferservice ausgewaehlt.');
    } else {
      ctx.log.warn('Kein Lieferservice-Button gefunden – bitte Marktwahl pruefen.');
      await ctx.capture('marktwahl-ohne-lieferservice');
    }
  }

  async isLoggedIn(ctx: DriverContext): Promise<boolean> {
    const { page, api } = requireBrowser(ctx);
    // Schnellster Weg: der Warenkorb-Endpunkt antwortet nur mit Session.
    const response = await api.get(url(REWE.api.cart), { failOnStatusCode: false }).catch(() => null);
    if (response && response.status() === 200) return true;
    return Boolean(await firstVisible(page, [...REWE.selectors.loggedInMarker], 2000));
  }

  async login(ctx: DriverContext, credentials: ShopCredentials): Promise<LoginResult> {
    const { page } = requireBrowser(ctx);
    ctx.log.info('Melde bei REWE an.');
    await page.goto(url(REWE.paths.login), { waitUntil: 'domcontentloaded' });
    await dismissConsentBanner(page, [...REWE.selectors.consent]);

    if (await firstVisible(page, [...REWE.selectors.captcha], 1500)) {
      await ctx.capture('rewe-captcha');
      return {
        ok: false,
        needsManualAction: true,
        message:
          'REWE zeigt ein Captcha. Bitte einmalig ueber "npm run shop:login" im sichtbaren Browser anmelden.',
      };
    }

    const emailSel = await firstVisible(page, [...REWE.selectors.loginEmail], 8000);
    const passSel = await firstVisible(page, [...REWE.selectors.loginPassword], 8000);
    if (!emailSel || !passSel) {
      await ctx.capture('rewe-login-formular');
      return { ok: false, message: 'Login-Formular nicht gefunden (Selektoren pruefen).' };
    }

    await typeLikeHuman(page, emailSel, credentials.username);
    await typeLikeHuman(page, passSel, credentials.password);
    const submit = await firstVisible(page, [...REWE.selectors.loginSubmit], 4000);
    if (submit) await page.locator(submit).first().click();
    await page.waitForLoadState('networkidle').catch(() => undefined);

    if (await this.isLoggedIn(ctx)) {
      await ctx.persistSession();
      ctx.log.info('Anmeldung erfolgreich.');
      return { ok: true };
    }

    const errorSel = await firstVisible(page, [...REWE.selectors.loginError], 2000);
    const message = errorSel
      ? ((await page.locator(errorSel).first().textContent()) ?? '').trim()
      : 'Anmeldung fehlgeschlagen.';
    await ctx.capture('rewe-login-fehlgeschlagen');
    return { ok: false, message: message || 'Anmeldung fehlgeschlagen.' };
  }

  async searchProducts(ctx: DriverContext, query: string, limit = 20): Promise<ProductCandidate[]> {
    const { api } = requireBrowser(ctx);
    const params = new URLSearchParams({
      search: query,
      objectsPerPage: String(limit),
      page: '1',
      serviceTypes: 'DELIVERY',
    });
    if (ctx.shop.marketId) params.set('market', ctx.shop.marketId);

    const response = await api
      .get(`${url(REWE.api.search)}?${params.toString()}`, {
        headers: { accept: 'application/json' },
        failOnStatusCode: false,
      })
      .catch(() => null);

    if (!response || !response.ok()) {
      ctx.log.warn(
        `Produktsuche ueber die API nicht moeglich (Status ${response?.status() ?? 'n/a'}), weiche auf die Seite aus.`,
      );
      return this.searchViaDom(ctx, query, limit);
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const products = extractReweProducts(payload).slice(0, limit);
    ctx.log.debug(`Suche "${query}": ${products.length} Treffer ueber die API.`);
    return products;
  }

  private async searchViaDom(
    ctx: DriverContext,
    query: string,
    limit: number,
  ): Promise<ProductCandidate[]> {
    const { page } = requireBrowser(ctx);
    await page.goto(`${url('/search')}?search=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
    });
    await dismissConsentBanner(page, [...REWE.selectors.consent]);
    const tiles = page.locator('[data-testid="product-tile"], article[data-productid]');
    const count = Math.min(await tiles.count(), limit);
    const results: ProductCandidate[] = [];
    for (let i = 0; i < count; i += 1) {
      const tile = tiles.nth(i);
      const externalId =
        (await tile.getAttribute('data-productid')) ?? (await tile.getAttribute('data-product-id'));
      const name = ((await tile.locator('[data-testid="product-title"], h3, h4').first().textContent()) ?? '')
        .trim();
      const priceText = ((await tile.locator('[data-testid="product-price"], .price').first().textContent()) ?? '')
        .trim();
      if (!externalId || !name) continue;
      results.push({
        externalId,
        name,
        priceCents: parsePriceToCents(priceText),
        productUrl: `${REWE.baseUrl}/produkte/${externalId}`,
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
    const response = await api
      .delete(url(REWE.api.cart), { failOnStatusCode: false })
      .catch(() => null);
    if (response?.ok()) {
      ctx.log.info('Warenkorb geleert.');
      return;
    }
    // Fallback: Positionen einzeln entfernen.
    const cart = await this.readCart(ctx);
    for (const cartLine of cart.lines) {
      await api
        .delete(`${url(REWE.api.cartLineItems)}/${encodeURIComponent(cartLine.externalId)}`, {
          failOnStatusCode: false,
        })
        .catch(() => null);
    }
    ctx.log.info(`Warenkorb geleert (${cart.lines.length} Positionen einzeln entfernt).`);
  }

  async addToCart(ctx: DriverContext, externalId: string, quantity: number): Promise<CartLine | null> {
    const { api } = requireBrowser(ctx);
    const response = await api
      .post(url(REWE.api.cartLineItems), {
        headers: { 'content-type': 'application/json' },
        data: { productId: externalId, quantity },
        failOnStatusCode: false,
      })
      .catch(() => null);

    if (!response || !response.ok()) {
      ctx.log.warn(`Artikel ${externalId} konnte nicht in den Warenkorb gelegt werden.`, {
        status: response?.status() ?? null,
      });
      return null;
    }
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const price = parsePriceToCents(
      (payload?.['unitPrice'] as unknown) ?? (payload?.['price'] as unknown),
    );
    return {
      externalId,
      label: String(payload?.['title'] ?? externalId),
      quantity,
      unitPriceCents: price,
      totalCents: price !== null ? price * quantity : null,
    };
  }

  async readCart(ctx: DriverContext): Promise<CartState> {
    const { api } = requireBrowser(ctx);
    const response = await api
      .get(url(REWE.api.cart), { headers: { accept: 'application/json' }, failOnStatusCode: false })
      .catch(() => null);
    if (!response || !response.ok()) return { lines: [], totalCents: 0 };
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return normalizeReweCart(payload);
  }

  async listDeliverySlots(ctx: DriverContext): Promise<DeliverySlot[]> {
    const { api } = requireBrowser(ctx);
    const response = await api
      .get(url(REWE.api.timeslots), { headers: { accept: 'application/json' }, failOnStatusCode: false })
      .catch(() => null);
    if (!response || !response.ok()) {
      ctx.log.warn('Lieferzeitfenster konnten nicht geladen werden.');
      return [];
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    return extractReweSlots(payload);
  }

  async chooseDeliverySlot(ctx: DriverContext, slot: DeliverySlot): Promise<void> {
    const { api } = requireBrowser(ctx);
    const response = await api
      .post(url(REWE.api.timeslots), {
        headers: { 'content-type': 'application/json' },
        data: { timeSlotId: slot.id },
        failOnStatusCode: false,
      })
      .catch(() => null);
    if (!response?.ok()) {
      throw new Error(`Lieferzeitfenster "${slot.label}" konnte nicht reserviert werden.`);
    }
    ctx.log.info(`Lieferzeitfenster reserviert: ${slot.label}`);
  }

  async placeOrder(ctx: DriverContext): Promise<{ reference: string | null }> {
    const { page } = requireBrowser(ctx);
    ctx.log.warn('Loese die kostenpflichtige Bestellung aus.');
    await page.goto(url(REWE.paths.checkout), { waitUntil: 'domcontentloaded' });
    await dismissConsentBanner(page, [...REWE.selectors.consent]);

    const button = await firstVisible(page, [...REWE.selectors.placeOrderButton], 10_000);
    if (!button) {
      await ctx.capture('rewe-checkout-ohne-button');
      throw new Error('Bestellbutton im Checkout nicht gefunden.');
    }
    await page.locator(button).first().click();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await ctx.capture('rewe-bestellbestaetigung');

    const refSel = await firstVisible(page, [...REWE.selectors.orderReference], 8000);
    const reference = refSel ? ((await page.locator(refSel).first().textContent()) ?? '').trim() : null;
    return { reference: reference || null };
  }
}

// ---------------------------------------------------------------------------
// Antwort-Normalisierung – die REWE-API hat mehrere Formate ueber die Jahre.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractReweProducts(payload: unknown): ProductCandidate[] {
  const root = asRecord(payload);
  if (!root) return [];
  const embedded = asRecord(root['_embedded']);
  const raw =
    (Array.isArray(root['products']) && root['products']) ||
    (embedded && Array.isArray(embedded['products']) && embedded['products']) ||
    (Array.isArray(root['items']) && root['items']) ||
    [];

  return (raw as unknown[])
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) return null;
      const articles = Array.isArray(item['articles']) ? (item['articles'] as unknown[]) : [];
      const article = asRecord(articles[0]) ?? item;
      const listing = asRecord(article['listing']) ?? asRecord(item['listing']) ?? article;
      const pricing = asRecord(listing['pricing']) ?? asRecord(listing['price']) ?? listing;

      const externalId = String(
        item['id'] ?? item['productId'] ?? article['id'] ?? listing['id'] ?? '',
      );
      const name = String(item['title'] ?? item['name'] ?? article['title'] ?? '').trim();
      if (!externalId || !name) return null;

      const candidate: ProductCandidate = {
        externalId,
        name,
        brand: item['brand'] ? String(asRecord(item['brand'])?.['name'] ?? item['brand']) : null,
        grammage: article['grammage'] ? String(article['grammage']) : null,
        priceCents: parsePriceToCents(
          (pricing['currentRetailPrice'] as unknown) ??
            (pricing['price'] as unknown) ??
            (pricing['value'] as unknown),
        ),
        basePrice: pricing['basePrice'] ? String(pricing['basePrice']) : null,
        imageUrl: typeof item['imageURL'] === 'string' ? item['imageURL'] : null,
        productUrl: `https://shop.rewe.de/p/${externalId}`,
        available: listing['isAvailable'] !== false,
      };
      return candidate;
    })
    .filter((p): p is ProductCandidate => p !== null);
}

export function normalizeReweCart(payload: Record<string, unknown> | null): CartState {
  if (!payload) return { lines: [], totalCents: 0 };
  const orderCart = asRecord(payload['orderCart']) ?? payload;
  const rawLines =
    (Array.isArray(orderCart['lineItems']) && orderCart['lineItems']) ||
    (Array.isArray(orderCart['items']) && orderCart['items']) ||
    [];

  const lines: CartLine[] = (rawLines as unknown[])
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) return null;
      const quantity = Number(item['quantity'] ?? 1) || 1;
      const unit = parsePriceToCents(
        (item['unitPrice'] as unknown) ?? (asRecord(item['price'])?.['value'] as unknown),
      );
      const total = parsePriceToCents(
        (item['totalPrice'] as unknown) ?? (item['subtotalPrice'] as unknown),
      );
      return {
        externalId: String(item['productId'] ?? item['id'] ?? ''),
        label: String(item['title'] ?? item['name'] ?? 'Artikel'),
        quantity,
        unitPriceCents: unit,
        totalCents: total ?? (unit !== null ? unit * quantity : null),
      } satisfies CartLine;
    })
    .filter((l): l is CartLine => l !== null && l.externalId !== '');

  const totalFromApi = parsePriceToCents(
    (orderCart['totalPrice'] as unknown) ??
      (asRecord(orderCart['pricing'])?.['total'] as unknown) ??
      (orderCart['grandTotal'] as unknown),
  );
  const totalCents = totalFromApi ?? lines.reduce((sum, l) => sum + (l.totalCents ?? 0), 0);
  // Mindestbestellwerte kommen als Euro-Betrag (z. B. 30 = 30,00 €).
  const minimum = parsePriceToCents(orderCart['minimumOrderValue'] as unknown, 'euros');
  return { lines, totalCents, minimumOrderCents: minimum };
}

export function extractReweSlots(payload: unknown): DeliverySlot[] {
  const root = asRecord(payload);
  if (!root) return [];
  const days =
    (Array.isArray(root['days']) && root['days']) ||
    (Array.isArray(root['timeSlots']) && root['timeSlots']) ||
    [];
  const slots: DeliverySlot[] = [];
  for (const dayEntry of days as unknown[]) {
    const day = asRecord(dayEntry);
    if (!day) continue;
    const entries = Array.isArray(day['timeSlots']) ? (day['timeSlots'] as unknown[]) : [dayEntry];
    for (const slotEntry of entries) {
      const slot = asRecord(slotEntry);
      if (!slot) continue;
      const id = String(slot['id'] ?? slot['timeSlotId'] ?? '');
      if (!id) continue;
      const start = String(slot['startTime'] ?? slot['from'] ?? '');
      const end = String(slot['endTime'] ?? slot['to'] ?? '');
      slots.push({
        id,
        label: `${start} – ${end}`.trim(),
        start,
        end,
        priceCents: parsePriceToCents(slot['price'] as unknown),
        available: slot['available'] !== false && slot['bookable'] !== false,
      });
    }
  }
  return slots;
}
