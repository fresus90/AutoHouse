import { config } from '../config.js';
import { logger } from '../logger.js';
import { executeRun } from '../automation/run-order.js';
import { getPlanById } from '../db/repo/plans.js';
import { getShop } from '../db/repo/shops.js';
import { createRun, updateRun } from '../db/repo/runs.js';
import { nowIso } from '../db/index.js';
import { errorMessage } from '../automation/util.js';
import type { OrderRun } from '../core/types.js';

const log = logger.child('queue');

interface QueueEntry {
  runId: string;
  planId: string;
  userId: string;
}

const pending: QueueEntry[] = [];
const active = new Set<string>();
/** Plaene, die gerade wartend oder laufend sind – verhindert Doppelstarts. */
const busyPlans = new Set<string>();

export function isPlanBusy(planId: string): boolean {
  return busyPlans.has(planId);
}

export function queueStatus(): { pending: number; active: number } {
  return { pending: pending.length, active: active.size };
}

/**
 * Stellt einen Lauf in die Warteschlange. Gibt den angelegten Lauf zurueck,
 * damit die Oberflaeche sofort darauf verlinken kann.
 */
export function enqueueRun(params: {
  planId: string;
  userId: string;
  trigger: 'schedule' | 'manual';
}): OrderRun | null {
  const plan = getPlanById(params.planId);
  if (!plan) return null;
  if (busyPlans.has(plan.id)) {
    log.warn(`Plan ${plan.id} laeuft bereits – erneutes Einplanen uebersprungen.`);
    return null;
  }

  const run = createRun({
    planId: plan.id,
    userId: params.userId,
    trigger: params.trigger,
    dryRun: plan.dryRun || !config.allowRealOrders || !plan.confirmOrder,
  });
  busyPlans.add(plan.id);
  pending.push({ runId: run.id, planId: plan.id, userId: params.userId });
  log.info(`Lauf ${run.id} fuer Plan "${plan.name}" eingeplant (${params.trigger}).`);
  void drain();
  return run;
}

async function drain(): Promise<void> {
  while (active.size < config.scheduler.maxConcurrentRuns && pending.length > 0) {
    const entry = pending.shift();
    if (!entry) break;
    active.add(entry.runId);
    void runEntry(entry).finally(() => {
      active.delete(entry.runId);
      busyPlans.delete(entry.planId);
      void drain();
    });
  }
}

async function runEntry(entry: QueueEntry): Promise<void> {
  const plan = getPlanById(entry.planId);
  const shop = plan ? getShop(entry.userId, plan.shopId) : undefined;
  if (!plan || !shop) {
    updateRun(entry.runId, {
      status: 'failed',
      errorCode: 'missing_config',
      errorMessage: 'Plan oder Shop wurde zwischenzeitlich geloescht.',
      finishedAt: nowIso(),
    });
    return;
  }
  if (!shop.enabled) {
    updateRun(entry.runId, {
      status: 'cancelled',
      errorCode: 'shop_disabled',
      errorMessage: `Shop "${shop.name}" ist deaktiviert.`,
      finishedAt: nowIso(),
    });
    return;
  }

  try {
    const outcome = await executeRun({ runId: entry.runId, plan, shop });
    log.info(`Lauf ${entry.runId} beendet: ${outcome.status}`);
  } catch (error) {
    log.error(`Lauf ${entry.runId} abgebrochen: ${errorMessage(error)}`);
    updateRun(entry.runId, {
      status: 'failed',
      errorCode: 'exception',
      errorMessage: errorMessage(error),
      finishedAt: nowIso(),
    });
  }
}

/** Wartet, bis die Warteschlange leer ist (fuer CLI und Tests). */
export async function waitForIdle(timeoutMs = 10 * 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((pending.length > 0 || active.size > 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
