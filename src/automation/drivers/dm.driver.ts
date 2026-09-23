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
import { dismissConsentBanner, firstVisible, parsePriceToCents } from '../util.js';
import { performLogin } from '../login.js';

/**
 * dm Onlineshop (dm.de)
 *
 * Anders als REWE hat dm keinen Lieferdienst mit Zeitfenstern, sondern
 * Paketversand – Lieferzeitfenster entfallen deshalb.
 *
 * Auch hier gilt: Session per Browser, Datenverkehr per JSON-Endpunkt.
 * Endpunkte und Selektoren stehen gebuendelt oben (siehe docs/shops.md).
 */
export const DM = {
  baseUrl: 'https://www.dm.de',
  searchApi: 'https://product-search.services.dmtech.com/de/search/crawl',
  paths: {
    home: '/',
    login: '/login',
    loginAlternatives: ['/anmelden', '/mein-dm'],
    cart: '/shop/warenkorb',
    checkout: '/shop/kasse',
  },
  api: {
    cart: '/shop/api/cart',
    cartItems: '/shop/api/cart/items',
  },
  selectors: {
    consent: [
      '#onetrust-accept-btn-handler',
      'button[data-dmid="button-accept-all"]',
      'button:has-text("Alle akzeptieren")',
    ],
    loginEmail: ['input[name="email"]', 'input[type="email"]', 'input#username'],
    loginPassword: ['input[name="password"]', 'input[type="password"]'],
    loginSubmit: ['button[type="submit"]', 'button:has-text("Anmelden")'],
    loggedInMarker: ['a[href*="/mein-dm"]', '[data-dmid="account-menu"]'],
    loginError: ['[data-dmid="error-message"]', '[role="alert"]'],
    captcha: ['iframe[src*="captcha"]', 'iframe[title*="reCAPTCHA"]'],
    cartRow: ['[data-dmid="cart-item"]', 'li[data-dmid="basket-item"]'],
    cartTotal: ['[data-dmid="cart-total-value"]', '[data-dmid="basket-total"]'],
    placeOrderButton: [
      'button[data-dmid="order-button"]',
      'button:has-text("Zahlungspflichtig bestellen")',
      'button:has-text("Jetzt kaufen")',
    ],
    orderReference: ['[data-dmid="order-number"]', '.order-number'],
  },
} as const;

const url = (p: string): string => `${DM.baseUrl}${p}`;

export class DmDriver implements ShopDriver {
  readonly provider = 'dm' as const;
  readonly label = 'dm Onlineshop';
  readonly supportsDeliverySlots = false;
  readonly requiresBrowser = true;

  async prepare(ctx: DriverContext): Promise<void> {
    const { page } = requireBrowser(ctx);
    await page.goto(url(DM.paths.home), { waitUntil: 'domcontentloaded' });
    if (await dismissConsentBanner(page, [...DM.selectors.consent])) {
      ctx.log.debug('Consent-Banner bestaetigt.');
    }
  }

  async isLoggedIn(ctx: DriverContext): Promise<boolean> {
    const { page, api } = requireBrowser(ctx);
    const response = await api.get(url(DM.api.cart), { failOnStatusCode: false }).catch(() => null);
    if (response && response.status() === 200) return true;
    return Boolean(await firstVisible(page, [...DM.selectors.loggedInMarker], 2000));
  }

  async login(ctx: DriverContext, credentials: ShopCredentials): Promise<LoginResult> {
    ctx.log.info('Melde bei dm an.');
    return performLogin(ctx, credentials, {
      urls: [DM.paths.login, ...DM.paths.loginAlternatives].map(url),
      consent: [...DM.selectors.consent],
      captcha: [...DM.selectors.captcha],
      isLoggedIn: () => this.isLoggedIn(ctx),
      shopLabel: 'dm',
    });
  }

  async searchProducts(ctx: DriverContext, query: string, limit = 20): Promise<ProductCandidate[]> {
    const { api } = requireBrowser(ctx);
    const params = new URLSearchParams({
      query,
      pageSize: String(limit),
      currentPage: '0',
      hideFacets: 'true',
      type: 'search',
    });
    const response = await api
      .get(`${DM.searchApi}?${params.toString()}`, {
        headers: { accept: 'application/json' },
        failOnStatusCode: false,
      })
      .catch(() => null);

    if (!response || !response.ok()) {
      ctx.log.warn(
        `dm-Produktsuche ueber die API nicht moeglich (Status ${response?.status() ?? 'n/a'}), weiche auf die Seite aus.`,
      );
      return this.searchViaDom(ctx, query, limit);
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    const products = extractDmProducts(payload).slice(0, limit);
    ctx.log.debug(`Suche "${query}": ${products.length} Treffer ueber die API.`);
    return products;
  }

  private async searchViaDom(
    ctx: DriverContext,
    query: string,
    limit: number,
  ): Promise<ProductCandidate[]> {
    const { page } = requireBrowser(ctx);
    await page.goto(`${url('/search')}?query=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
    });
    await dismissConsentBanner(page, [...DM.selectors.consent]);
    const tiles = page.locator('[data-dmid="product-tile"], article[data-dmid="product"]');
    const count = Math.min(await tiles.count(), limit);
    const results: ProductCandidate[] = [];
    for (let i = 0; i < count; i += 1) {
      const tile = tiles.nth(i);
      const externalId =
        (await tile.getAttribute('data-gtin')) ?? (await tile.getAttribute('data-dan')) ?? null;
      const name = ((await tile.locator('[data-dmid="product-name"], h3').first().textContent()) ?? '').trim();
      const priceText = ((await tile.locator('[data-dmid="price-localized"], .price').first().textContent()) ?? '')
        .trim();
      if (!externalId || !name) continue;
      results.push({
        externalId,
        name,
        priceCents: parsePriceToCents(priceText),
        productUrl: `${DM.baseUrl}/product-p${externalId}.html`,
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
    for (const cartLine of cart.lines) {
      await api
        .delete(`${url(DM.api.cartItems)}/${encodeURIComponent(cartLine.externalId)}`, {
          failOnStatusCode: false,
        })
        .catch(() => null);
    }
    ctx.log.info(`Warenkorb geleert (${cart.lines.length} Positionen).`);
  }

  async addToCart(ctx: DriverContext, externalId: string, quantity: number): Promise<CartLine | null> {
    const { api } = requireBrowser(ctx);
    const response = await api
      .post(url(DM.api.cartItems), {
        headers: { 'content-type': 'application/json' },
        data: { gtin: externalId, quantity },
        failOnStatusCode: false,
      })
      .catch(() => null);
    if (!response || !response.ok()) {
      ctx.log.warn(`Artikel ${externalId} konnte nicht in den dm-Warenkorb gelegt werden.`, {
        status: response?.status() ?? null,
      });
      return null;
    }
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const price = parsePriceToCents((payload?.['price'] as unknown) ?? (payload?.['unitPrice'] as unknown));
    return {
      externalId,
      label: String(payload?.['name'] ?? externalId),
      quantity,
      unitPriceCents: price,
      totalCents: price !== null ? price * quantity : null,
    };
  }

  async readCart(ctx: DriverContext): Promise<CartState> {
    const { api, page } = requireBrowser(ctx);
    const response = await api
      .get(url(DM.api.cart), { headers: { accept: 'application/json' }, failOnStatusCode: false })
      .catch(() => null);
    if (response?.ok()) {
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const normalized = normalizeDmCart(payload);
      if (normalized.lines.length > 0 || normalized.totalCents > 0) return normalized;
    }

    // Fallback ueber die Warenkorbseite.
    await page.goto(url(DM.paths.cart), { waitUntil: 'domcontentloaded' });
    await dismissConsentBanner(page, [...DM.selectors.consent]);
    const rows = page.locator(DM.selectors.cartRow.join(', '));
    const count = await rows.count();
    const lines: CartLine[] = [];
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const label = ((await row.locator('[data-dmid="product-name"], h3').first().textContent()) ?? '').trim();
      const qty = Number(
        ((await row.locator('input[type="number"]').first().inputValue().catch(() => '1')) || '1').trim(),
      );
      const total = parsePriceToCents(
        ((await row.locator('[data-dmid="price-localized"], .price').first().textContent()) ?? '').trim(),
      );
      lines.push({
        externalId: (await row.getAttribute('data-gtin')) ?? label,
        label: label || 'Artikel',
        quantity: Number.isFinite(qty) ? qty : 1,
        unitPriceCents: total !== null && qty > 0 ? Math.round(total / qty) : null,
        totalCents: total,
      });
    }
    const totalSel = await firstVisible(page, [...DM.selectors.cartTotal], 3000);
    const totalCents = totalSel
      ? (parsePriceToCents(((await page.locator(totalSel).first().textContent()) ?? '').trim()) ?? 0)
      : lines.reduce((sum, l) => sum + (l.totalCents ?? 0), 0);
    return { lines, totalCents };
  }

  async placeOrder(ctx: DriverContext): Promise<{ reference: string | null }> {
    const { page } = requireBrowser(ctx);
    ctx.log.warn('Loese die kostenpflichtige Bestellung aus.');
    await page.goto(url(DM.paths.checkout), { waitUntil: 'domcontentloaded' });
    await dismissConsentBanner(page, [...DM.selectors.consent]);

    const button = await firstVisible(page, [...DM.selectors.placeOrderButton], 10_000);
    if (!button) {
      await ctx.capture('dm-checkout-ohne-button');
      throw new Error('Bestellbutton im dm-Checkout nicht gefunden.');
    }
    await page.locator(button).first().click();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await ctx.capture('dm-bestellbestaetigung');

    const refSel = await firstVisible(page, [...DM.selectors.orderReference], 8000);
    const reference = refSel ? ((await page.locator(refSel).first().textContent()) ?? '').trim() : null;
    return { reference: reference || null };
  }
}

// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractDmProducts(payload: unknown): ProductCandidate[] {
  const root = asRecord(payload);
  if (!root) return [];
  const raw =
    (Array.isArray(root['products']) && root['products']) ||
    (Array.isArray(root['results']) && root['results']) ||
    (Array.isArray(root['items']) && root['items']) ||
    [];

  return (raw as unknown[])
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) return null;
      const price = asRecord(item['price']) ?? item;
      const externalId = String(item['gtin'] ?? item['dan'] ?? item['id'] ?? '');
      const name = String(item['name'] ?? item['title'] ?? '').trim();
      if (!externalId || !name) return null;
      const relative = typeof item['relativeProductUrl'] === 'string' ? item['relativeProductUrl'] : null;
      const candidate: ProductCandidate = {
        externalId,
        name,
        brand: item['brandName'] ? String(item['brandName']) : null,
        grammage: item['netQuantityContent'] ? String(item['netQuantityContent']) : null,
        priceCents: parsePriceToCents((price['value'] as unknown) ?? (price['formattedValue'] as unknown)),
        basePrice: item['basePrice'] ? String(item['basePrice']) : null,
        imageUrl: typeof item['imageUrlTemplates'] === 'string' ? item['imageUrlTemplates'] : null,
        productUrl: relative ? `${DM.baseUrl}${relative}` : `${DM.baseUrl}/product-p${externalId}.html`,
        available: item['available'] !== false && item['purchasable'] !== false,
      };
      return candidate;
    })
    .filter((p): p is ProductCandidate => p !== null);
}

export function normalizeDmCart(payload: Record<string, unknown> | null): CartState {
  if (!payload) return { lines: [], totalCents: 0 };
  const raw =
    (Array.isArray(payload['entries']) && payload['entries']) ||
    (Array.isArray(payload['items']) && payload['items']) ||
    [];
  const lines: CartLine[] = (raw as unknown[])
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) return null;
      const product = asRecord(item['product']) ?? item;
      const quantity = Number(item['quantity'] ?? 1) || 1;
      const total = parsePriceToCents(
        (asRecord(item['totalPrice'])?.['value'] as unknown) ?? (item['totalPrice'] as unknown),
      );
      const unit = parsePriceToCents(
        (asRecord(item['basePrice'])?.['value'] as unknown) ?? (item['unitPrice'] as unknown),
      );
      return {
        externalId: String(product['gtin'] ?? product['dan'] ?? product['code'] ?? ''),
        label: String(product['name'] ?? 'Artikel'),
        quantity,
        unitPriceCents: unit ?? (total !== null ? Math.round(total / quantity) : null),
        totalCents: total ?? (unit !== null ? unit * quantity : null),
      } satisfies CartLine;
    })
    .filter((l): l is CartLine => l !== null && l.externalId !== '');

  const totalCents =
    parsePriceToCents(
      (asRecord(payload['totalPrice'])?.['value'] as unknown) ?? (payload['totalPrice'] as unknown),
    ) ?? lines.reduce((sum, l) => sum + (l.totalCents ?? 0), 0);
  return { lines, totalCents };
}
