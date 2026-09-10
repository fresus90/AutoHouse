import { all, get, nowIso, run } from '../index.js';
import { newId } from '../../core/crypto.js';
import type { Product } from '../../core/types.js';

interface ProductRow {
  id: string;
  shop_id: string;
  external_id: string;
  name: string;
  brand: string | null;
  grammage: string | null;
  price_cents: number | null;
  base_price: string | null;
  image_url: string | null;
  product_url: string | null;
  last_seen_at: string;
}

const map = (row: ProductRow): Product => ({
  id: row.id,
  shopId: row.shop_id,
  externalId: row.external_id,
  name: row.name,
  brand: row.brand,
  grammage: row.grammage,
  priceCents: row.price_cents,
  basePrice: row.base_price,
  imageUrl: row.image_url,
  productUrl: row.product_url,
  lastSeenAt: row.last_seen_at,
});

export interface ProductInput {
  externalId: string;
  name: string;
  brand?: string | null;
  grammage?: string | null;
  priceCents?: number | null;
  basePrice?: string | null;
  imageUrl?: string | null;
  productUrl?: string | null;
}

/** Legt das Produkt an oder aktualisiert Preis/Namen (Upsert je Shop + Artikelnummer). */
export function upsertProduct(shopId: string, input: ProductInput): Product {
  const ts = nowIso();
  const existing = get<ProductRow>(
    'SELECT * FROM products WHERE shop_id = ? AND external_id = ?',
    shopId,
    input.externalId,
  );
  if (existing) {
    run(
      `UPDATE products SET name = ?, brand = ?, grammage = ?, price_cents = ?, base_price = ?,
                           image_url = ?, product_url = ?, last_seen_at = ?
       WHERE id = ?`,
      input.name,
      input.brand ?? existing.brand,
      input.grammage ?? existing.grammage,
      input.priceCents ?? existing.price_cents,
      input.basePrice ?? existing.base_price,
      input.imageUrl ?? existing.image_url,
      input.productUrl ?? existing.product_url,
      ts,
      existing.id,
    );
    return map(get<ProductRow>('SELECT * FROM products WHERE id = ?', existing.id)!);
  }
  const id = newId('prd');
  run(
    `INSERT INTO products (id, shop_id, external_id, name, brand, grammage, price_cents,
                           base_price, image_url, product_url, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    shopId,
    input.externalId,
    input.name,
    input.brand ?? null,
    input.grammage ?? null,
    input.priceCents ?? null,
    input.basePrice ?? null,
    input.imageUrl ?? null,
    input.productUrl ?? null,
    ts,
    ts,
  );
  return map(get<ProductRow>('SELECT * FROM products WHERE id = ?', id)!);
}

export function listProducts(shopId: string, search?: string, limit = 50): Product[] {
  if (search && search.trim()) {
    return all<ProductRow>(
      `SELECT * FROM products WHERE shop_id = ? AND (name LIKE ? OR brand LIKE ? OR external_id = ?)
       ORDER BY last_seen_at DESC LIMIT ?`,
      shopId,
      `%${search.trim()}%`,
      `%${search.trim()}%`,
      search.trim(),
      limit,
    ).map(map);
  }
  return all<ProductRow>(
    'SELECT * FROM products WHERE shop_id = ? ORDER BY last_seen_at DESC LIMIT ?',
    shopId,
    limit,
  ).map(map);
}

export function getProduct(productId: string): Product | undefined {
  const row = get<ProductRow>('SELECT * FROM products WHERE id = ?', productId);
  return row ? map(row) : undefined;
}
