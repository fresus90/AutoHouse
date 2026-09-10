import type { APIRequestContext, BrowserContext, Page } from 'playwright';
import type { BudgetStrategy, DeliveryPreference, ProviderSlug, ShopCredentials } from '../core/types.js';

/** Laufzeit-Infos zum Shop-Konto, die der Treiber braucht. */
export interface ShopRuntime {
  id: string;
  provider: ProviderSlug;
  name: string;
  postalCode: string | null;
  marketId: string | null;
}

export interface RunLog {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * Browser-Bindung eines Laufs.
 *
 * `api` ist der HTTP-Client des Browser-Kontexts: er teilt Cookies und Header
 * mit der Seite. Damit koennen Treiber die JSON-Endpunkte des Shops direkt
 * ansprechen, statt jede Aktion durchs DOM zu klicken – das ist um ein
 * Vielfaches schneller und unempfindlicher gegen Layout-Aenderungen.
 */
export interface BrowserBinding {
  page: Page;
  context: BrowserContext;
  api: APIRequestContext;
}

/** Alles, was ein Treiber zur Laufzeit bekommt. */
export interface DriverContext {
  /** null bei Treibern mit `requiresBrowser = false` (z. B. dem Demo-Shop). */
  browser: BrowserBinding | null;
  log: RunLog;
  shop: ShopRuntime;
  dryRun: boolean;
  /** Screenshot + HTML-Dump zur Fehlersuche ablegen. */
  capture(label: string): Promise<void>;
  /** Storage-State sichern, damit der naechste Lauf nicht neu einloggen muss. */
  persistSession(): Promise<void>;
}

export interface ProductCandidate {
  externalId: string;
  name: string;
  brand?: string | null;
  grammage?: string | null;
  priceCents?: number | null;
  basePrice?: string | null;
  imageUrl?: string | null;
  productUrl?: string | null;
  available?: boolean;
}

export interface CartLine {
  externalId: string;
  label: string;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number | null;
}

export interface CartState {
  lines: CartLine[];
  totalCents: number;
  /** Vom Shop gemeldeter Mindestbestellwert, falls auslesbar. */
  minimumOrderCents?: number | null;
}

export interface DeliveryWish {
  preference: DeliveryPreference;
  weekday: number | null;
  from: string | null;
  to: string | null;
}

export interface DeliverySlot {
  id: string;
  label: string;
  start: string;
  end: string;
  priceCents: number | null;
  available: boolean;
}

export interface OrderItemRequest {
  planItemId: string | null;
  label: string;
  externalId: string | null;
  searchTerm: string | null;
  quantity: number;
  maxUnitPriceCents: number | null;
  priority: number;
  optional: boolean;
  allowSubstitute: boolean;
}

export interface OrderRequest {
  items: OrderItemRequest[];
  maxTotalCents: number;
  minTotalCents: number;
  budgetStrategy: BudgetStrategy;
  delivery: DeliveryWish;
  /** Nur true, wenn Plan UND globaler Schalter die Bestellung erlauben. */
  confirmOrder: boolean;
}

export interface LoginResult {
  ok: boolean;
  message?: string;
  /** true, wenn ein Mensch eingreifen muss (Captcha, 2FA, gesperrtes Konto). */
  needsManualAction?: boolean;
}

/**
 * Was ein Shop koennen muss. Die Bestell-Logik (Budget, Prioritaeten,
 * Reihenfolge, Protokoll) liegt bewusst NICHT hier, sondern einmal zentral in
 * `run-order.ts`. Ein neuer Shop braucht damit nur diese Bausteine.
 */
export interface ShopDriver {
  readonly provider: ProviderSlug;
  readonly label: string;
  /** Liefert der Shop Lieferzeitfenster? (dm: nein, REWE: ja) */
  readonly supportsDeliverySlots: boolean;
  /** false nur fuer Treiber, die ohne echten Browser auskommen. */
  readonly requiresBrowser: boolean;

  /** Cookie-Banner, Marktwahl, PLZ – alles vor dem Login. */
  prepare(ctx: DriverContext): Promise<void>;
  /** Ist die mitgebrachte Session noch gueltig? */
  isLoggedIn(ctx: DriverContext): Promise<boolean>;
  login(ctx: DriverContext, credentials: ShopCredentials): Promise<LoginResult>;

  searchProducts(ctx: DriverContext, query: string, limit?: number): Promise<ProductCandidate[]>;
  getProduct(ctx: DriverContext, externalId: string): Promise<ProductCandidate | null>;

  clearCart(ctx: DriverContext): Promise<void>;
  addToCart(ctx: DriverContext, externalId: string, quantity: number): Promise<CartLine | null>;
  readCart(ctx: DriverContext): Promise<CartState>;

  listDeliverySlots?(ctx: DriverContext): Promise<DeliverySlot[]>;
  chooseDeliverySlot?(ctx: DriverContext, slot: DeliverySlot): Promise<void>;

  /** Letzter Schritt: kostenpflichtig bestellen. */
  placeOrder(ctx: DriverContext): Promise<{ reference: string | null }>;
}

/** Zugriff auf den Browser erzwingen – wirft, wenn der Lauf ohne laeuft. */
export function requireBrowser(ctx: DriverContext): BrowserBinding {
  if (!ctx.browser) {
    throw new Error('Dieser Shop-Treiber benoetigt einen Browser-Kontext.');
  }
  return ctx.browser;
}
