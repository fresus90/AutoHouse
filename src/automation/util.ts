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
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1500 })) {
        await locator.click({ timeout: 3000 });
        await page.waitForTimeout(400);
        return true;
      }
    } catch {
      // naechster Selektor
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
