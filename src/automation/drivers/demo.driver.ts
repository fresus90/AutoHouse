import type { ShopCredentials } from '../../core/types.js';
import type {
  CartLine,
  CartState,
  DeliverySlot,
  DriverContext,
  LoginResult,
  ProductCandidate,
  ShopDriver,
} from '../types.js';

/**
 * Demo-Shop – ein vollstaendig lokaler Shop ohne Netzwerk und ohne Browser.
 *
 * Zweck: Die gesamte Kette (Zeitplan -> Lauf -> Budget -> Ergebnis -> UI) laesst
 * sich damit testen, ohne bei dm oder REWE etwas auszuloesen. Ideal fuer die
 * Ersteinrichtung und fuer automatisierte Tests.
 */
const CATALOGUE: ProductCandidate[] = [
  { externalId: 'demo-milch', name: 'Frische Vollmilch 3,8 %', brand: 'Demo Hof', grammage: '1 l', priceCents: 119 },
  { externalId: 'demo-butter', name: 'Deutsche Markenbutter', brand: 'Demo Hof', grammage: '250 g', priceCents: 229 },
  { externalId: 'demo-brot', name: 'Roggenmischbrot geschnitten', brand: 'Demo Baeckerei', grammage: '750 g', priceCents: 189 },
  { externalId: 'demo-eier', name: 'Bio-Eier Freilandhaltung', brand: 'Demo Hof', grammage: '10 Stueck', priceCents: 349 },
  { externalId: 'demo-kaffee', name: 'Kaffee ganze Bohne', brand: 'Demo Roesterei', grammage: '1 kg', priceCents: 1499 },
  { externalId: 'demo-nudeln', name: 'Spaghetti No. 5', brand: 'Demo Pasta', grammage: '500 g', priceCents: 149 },
  { externalId: 'demo-tomaten', name: 'Passierte Tomaten', brand: 'Demo Garten', grammage: '500 g', priceCents: 99 },
  { externalId: 'demo-apfel', name: 'Aepfel Elstar', brand: 'Demo Obsthof', grammage: '1 kg', priceCents: 299 },
  { externalId: 'demo-shampoo', name: 'Shampoo Sensitiv', brand: 'Demo Care', grammage: '300 ml', priceCents: 279 },
  { externalId: 'demo-zahnpasta', name: 'Zahncreme Complete', brand: 'Demo Care', grammage: '75 ml', priceCents: 199 },
];

export class DemoDriver implements ShopDriver {
  readonly provider = 'demo' as const;
  readonly label = 'Demo-Shop (ohne echte Bestellung)';
  readonly supportsDeliverySlots = true;
  readonly requiresBrowser = false;

  private carts = new Map<string, CartLine[]>();

  async prepare(ctx: DriverContext): Promise<void> {
    ctx.log.info('Demo-Shop bereit – es werden keine echten Anfragen gestellt.');
  }

  async isLoggedIn(): Promise<boolean> {
    return true;
  }

  async login(_ctx: DriverContext, _credentials: ShopCredentials): Promise<LoginResult> {
    return { ok: true, message: 'Demo-Shop benoetigt keine Anmeldung.' };
  }

  async searchProducts(_ctx: DriverContext, query: string, limit = 20): Promise<ProductCandidate[]> {
    const needle = query.trim().toLowerCase();
    return CATALOGUE.filter(
      (product) =>
        !needle ||
        product.name.toLowerCase().includes(needle) ||
        (product.brand ?? '').toLowerCase().includes(needle) ||
        product.externalId.includes(needle),
    )
      .slice(0, limit)
      .map((product) => ({ ...product, available: true, productUrl: `https://example.invalid/${product.externalId}` }));
  }

  async getProduct(_ctx: DriverContext, externalId: string): Promise<ProductCandidate | null> {
    return CATALOGUE.find((product) => product.externalId === externalId) ?? null;
  }

  async clearCart(ctx: DriverContext): Promise<void> {
    this.carts.set(ctx.shop.id, []);
  }

  async addToCart(ctx: DriverContext, externalId: string, quantity: number): Promise<CartLine | null> {
    const product = CATALOGUE.find((entry) => entry.externalId === externalId);
    if (!product) return null;
    const unit = product.priceCents ?? null;
    const line: CartLine = {
      externalId,
      label: product.name,
      quantity,
      unitPriceCents: unit,
      totalCents: unit !== null ? unit * quantity : null,
    };
    const cart = this.carts.get(ctx.shop.id) ?? [];
    cart.push(line);
    this.carts.set(ctx.shop.id, cart);
    return line;
  }

  async readCart(ctx: DriverContext): Promise<CartState> {
    const lines = this.carts.get(ctx.shop.id) ?? [];
    return {
      lines,
      totalCents: lines.reduce((sum, line) => sum + (line.totalCents ?? 0), 0),
      minimumOrderCents: 0,
    };
  }

  async listDeliverySlots(): Promise<DeliverySlot[]> {
    const slots: DeliverySlot[] = [];
    for (let day = 1; day <= 3; day += 1) {
      const date = new Date(Date.now() + day * 86_400_000);
      const iso = date.toISOString().slice(0, 10);
      slots.push({
        id: `demo-${iso}-am`,
        label: `${iso} 08:00 – 12:00`,
        start: `${iso}T08:00:00`,
        end: `${iso}T12:00:00`,
        priceCents: 299,
        available: true,
      });
      slots.push({
        id: `demo-${iso}-pm`,
        label: `${iso} 17:00 – 20:00`,
        start: `${iso}T17:00:00`,
        end: `${iso}T20:00:00`,
        priceCents: 499,
        available: true,
      });
    }
    return slots;
  }

  async chooseDeliverySlot(ctx: DriverContext, slot: DeliverySlot): Promise<void> {
    ctx.log.info(`Demo-Lieferfenster gewaehlt: ${slot.label}`);
  }

  async placeOrder(ctx: DriverContext): Promise<{ reference: string | null }> {
    const reference = `DEMO-${Date.now().toString(36).toUpperCase()}`;
    ctx.log.info(`Demo-Bestellung abgeschlossen: ${reference}`);
    this.carts.set(ctx.shop.id, []);
    return { reference };
  }
}
