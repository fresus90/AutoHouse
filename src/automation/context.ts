import { logger } from '../logger.js';
import { addRunArtifact, addRunLog } from '../db/repo/runs.js';
import { getSessionState, saveSessionState } from '../db/repo/shops.js';
import type { Shop } from '../core/types.js';
import { captureArtifacts, createSession } from './browser.js';
import { getDriver } from './registry.js';
import type { DriverContext, RunLog, ShopDriver } from './types.js';

export interface ContextOptions {
  shop: Shop;
  /** Wenn gesetzt, landen Protokoll und Screenshots am Lauf. */
  runId?: string | null;
  dryRun?: boolean;
  /** Fuer den Login-Assistenten: sichtbarer Browser. */
  headless?: boolean;
  /** Gespeicherte Session ignorieren und frisch starten. */
  freshSession?: boolean;
}

/** Protokoll, das je nach Kontext in die DB oder nur auf die Konsole geht. */
function createRunLog(runId: string | null | undefined, scope: string): RunLog {
  const base = logger.child(scope);
  const write = (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void => {
    base[level](message, data);
    if (runId) addRunLog(runId, level, message, data);
  };
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}

/**
 * Baut den Treiber-Kontext auf, fuehrt `fn` aus und raeumt danach auf.
 * Der Browser wird nur gestartet, wenn der Treiber ihn wirklich braucht.
 */
export async function withDriverContext<T>(
  options: ContextOptions,
  fn: (driver: ShopDriver, ctx: DriverContext) => Promise<T>,
): Promise<T> {
  const driver = getDriver(options.shop.provider);
  const log = createRunLog(options.runId, `shop:${options.shop.provider}`);
  const runId = options.runId ?? null;

  let session: Awaited<ReturnType<typeof createSession>> | null = null;
  if (driver.requiresBrowser) {
    const storageState = options.freshSession ? null : getSessionState(options.shop.id);
    if (storageState) log.debug('Gespeicherte Browser-Session wird wiederverwendet.');
    session = await createSession({
      ...(storageState ? { storageState } : {}),
      ...(options.headless === undefined ? {} : { headless: options.headless }),
    });
  }

  const ctx: DriverContext = {
    browser: session ? { page: session.page, context: session.context, api: session.page.request } : null,
    log,
    shop: {
      id: options.shop.id,
      provider: options.shop.provider,
      name: options.shop.name,
      postalCode: options.shop.postalCode,
      marketId: options.shop.marketId,
    },
    dryRun: options.dryRun ?? true,
    async capture(label: string) {
      if (!session || !runId) return;
      const artifacts = await captureArtifacts(session.page, runId, label);
      addRunArtifact(runId, 'screenshot', artifacts.screenshot, label);
      addRunArtifact(runId, 'html', artifacts.html, label);
      log.debug(`Screenshot abgelegt: ${label}`);
    },
    async persistSession() {
      if (!session) return;
      const state = await session.context.storageState();
      saveSessionState(options.shop.id, state);
      log.debug('Browser-Session gespeichert.');
    },
  };

  try {
    return await fn(driver, ctx);
  } finally {
    if (session) {
      // Session am Ende sichern, damit der naechste Lauf ohne Login startet.
      await session.context
        .storageState()
        .then((state) => saveSessionState(options.shop.id, state))
        .catch(() => undefined);
      await session.close();
    }
  }
}
