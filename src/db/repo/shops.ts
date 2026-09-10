import { all, get, nowIso, run, toBool, toInt } from '../index.js';
import { decryptJson, encryptJson, newId } from '../../core/crypto.js';
import type { ProviderSlug, Shop, ShopCredentials } from '../../core/types.js';

interface ShopRow {
  id: string;
  user_id: string;
  provider: ProviderSlug;
  name: string;
  enabled: number;
  postal_code: string | null;
  market_id: string | null;
  credentials_enc: string | null;
  session_state_enc: string | null;
  session_valid_until: string | null;
  connection_status: 'unknown' | 'ok' | 'error';
  connection_message: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Nach aussen werden nie Geheimnisse gereicht, nur die Info "ist gesetzt". */
function map(row: ShopRow): Shop {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    name: row.name,
    enabled: toBool(row.enabled),
    postalCode: row.postal_code,
    marketId: row.market_id,
    hasCredentials: Boolean(row.credentials_enc),
    hasSession: Boolean(row.session_state_enc),
    sessionValidUntil: row.session_valid_until,
    connectionStatus: row.connection_status,
    connectionMessage: row.connection_message,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ShopInput {
  provider: ProviderSlug;
  name: string;
  enabled?: boolean;
  postalCode?: string | null;
  marketId?: string | null;
  credentials?: ShopCredentials | null;
}

export function listShops(userId: string): Shop[] {
  return all<ShopRow>('SELECT * FROM shops WHERE user_id = ? ORDER BY created_at', userId).map(map);
}

export function getShop(userId: string, shopId: string): Shop | undefined {
  const row = get<ShopRow>('SELECT * FROM shops WHERE id = ? AND user_id = ?', shopId, userId);
  return row ? map(row) : undefined;
}

export function getShopRow(shopId: string): ShopRow | undefined {
  return get<ShopRow>('SELECT * FROM shops WHERE id = ?', shopId);
}

export function createShop(userId: string, input: ShopInput): Shop {
  const id = newId('shop');
  const ts = nowIso();
  run(
    `INSERT INTO shops (id, user_id, provider, name, enabled, postal_code, market_id,
                        credentials_enc, connection_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)`,
    id,
    userId,
    input.provider,
    input.name,
    toInt(input.enabled ?? true),
    input.postalCode ?? null,
    input.marketId ?? null,
    input.credentials ? encryptJson(input.credentials) : null,
    ts,
    ts,
  );
  return getShop(userId, id)!;
}

export function updateShop(userId: string, shopId: string, input: Partial<ShopInput>): Shop | undefined {
  const existing = get<ShopRow>('SELECT * FROM shops WHERE id = ? AND user_id = ?', shopId, userId);
  if (!existing) return undefined;

  // credentials === null loescht die Zugangsdaten, undefined laesst sie stehen.
  const credentials =
    input.credentials === undefined
      ? existing.credentials_enc
      : input.credentials === null
        ? null
        : encryptJson(input.credentials);

  run(
    `UPDATE shops SET name = ?, enabled = ?, postal_code = ?, market_id = ?,
                      credentials_enc = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    input.name ?? existing.name,
    toInt(input.enabled ?? toBool(existing.enabled)),
    input.postalCode === undefined ? existing.postal_code : input.postalCode,
    input.marketId === undefined ? existing.market_id : input.marketId,
    credentials,
    nowIso(),
    shopId,
    userId,
  );
  return getShop(userId, shopId);
}

export function deleteShop(userId: string, shopId: string): boolean {
  const existing = getShop(userId, shopId);
  if (!existing) return false;
  run('DELETE FROM shops WHERE id = ? AND user_id = ?', shopId, userId);
  return true;
}

export function getCredentials(shopId: string): ShopCredentials | null {
  const row = getShopRow(shopId);
  if (!row?.credentials_enc) return null;
  return decryptJson<ShopCredentials>(row.credentials_enc);
}

export function getSessionState(shopId: string): unknown | null {
  const row = getShopRow(shopId);
  if (!row?.session_state_enc) return null;
  if (row.session_valid_until && new Date(row.session_valid_until).getTime() < Date.now()) {
    return null;
  }
  return decryptJson<unknown>(row.session_state_enc);
}

export function saveSessionState(shopId: string, state: unknown, validForDays = 14): void {
  run(
    'UPDATE shops SET session_state_enc = ?, session_valid_until = ?, updated_at = ? WHERE id = ?',
    encryptJson(state),
    new Date(Date.now() + validForDays * 86_400_000).toISOString(),
    nowIso(),
    shopId,
  );
}

export function clearSessionState(shopId: string): void {
  run(
    'UPDATE shops SET session_state_enc = NULL, session_valid_until = NULL, updated_at = ? WHERE id = ?',
    nowIso(),
    shopId,
  );
}

export function setConnectionStatus(
  shopId: string,
  status: 'unknown' | 'ok' | 'error',
  message?: string | null,
): void {
  run(
    'UPDATE shops SET connection_status = ?, connection_message = ?, last_checked_at = ?, updated_at = ? WHERE id = ?',
    status,
    message ?? null,
    nowIso(),
    nowIso(),
    shopId,
  );
}
