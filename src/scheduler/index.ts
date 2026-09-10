import { config } from '../config.js';
import { logger } from '../logger.js';
import { findDuePlans, markPlanRun } from '../db/repo/plans.js';
import { purgeExpiredSessions } from '../db/repo/sessions.js';
import { failStaleRuns } from '../db/repo/runs.js';
import { formatZoned } from '../core/time.js';
import { enqueueRun, isPlanBusy } from './queue.js';

const log = logger.child('scheduler');

let timer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (!config.scheduler.enabled) {
    log.warn('Scheduler ist per Konfiguration deaktiviert (SCHEDULER_ENABLED=false).');
    return;
  }
  const recovered = failStaleRuns();
  if (recovered > 0) log.warn(`${recovered} unterbrochene Laeufe wurden als fehlgeschlagen markiert.`);

  log.info(`Scheduler laeuft (Takt ${config.scheduler.tickMs} ms, Zeitzone ${config.timezone}).`);
  tick();
  timer = setInterval(tick, config.scheduler.tickMs);
  timer.unref?.();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function tick(): void {
  try {
    purgeExpiredSessions();
    const due = findDuePlans(new Date());
    for (const plan of due) {
      if (isPlanBusy(plan.id)) continue;
      log.info(`Faelliger Plan: "${plan.name}" (geplant ${formatZoned(new Date(plan.nextRunAt!), config.timezone)}).`);
      // Termin sofort weiterdrehen, damit derselbe Plan nicht mehrfach startet.
      markPlanRun(plan.id, new Date());
      enqueueRun({ planId: plan.id, userId: plan.userId, trigger: 'schedule' });
    }
  } catch (error) {
    log.error('Fehler im Scheduler-Takt', error);
  }
}
