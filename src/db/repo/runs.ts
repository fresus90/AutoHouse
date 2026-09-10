import { all, get, nowIso, run, toBool, toInt } from '../index.js';
import { newId } from '../../core/crypto.js';
import type {
  OrderRun,
  OrderRunItem,
  RunArtifact,
  RunItemStatus,
  RunLogEntry,
  RunStatus,
} from '../../core/types.js';

interface RunRow {
  id: string;
  plan_id: string;
  user_id: string;
  status: RunStatus;
  trigger: 'schedule' | 'manual';
  dry_run: number;
  planned_total_cents: number | null;
  cart_total_cents: number | null;
  order_reference: string | null;
  delivery_slot: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

const mapRun = (row: RunRow): OrderRun => ({
  id: row.id,
  planId: row.plan_id,
  userId: row.user_id,
  status: row.status,
  trigger: row.trigger,
  dryRun: toBool(row.dry_run),
  plannedTotalCents: row.planned_total_cents,
  cartTotalCents: row.cart_total_cents,
  orderReference: row.order_reference,
  deliverySlot: row.delivery_slot,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export function createRun(params: {
  planId: string;
  userId: string;
  trigger: 'schedule' | 'manual';
  dryRun: boolean;
}): OrderRun {
  const id = newId('run');
  const ts = nowIso();
  run(
    `INSERT INTO order_runs (id, plan_id, user_id, status, trigger, dry_run, started_at, created_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
    id,
    params.planId,
    params.userId,
    params.trigger,
    toInt(params.dryRun),
    ts,
    ts,
  );
  return mapRun(get<RunRow>('SELECT * FROM order_runs WHERE id = ?', id)!);
}

export function updateRun(
  runId: string,
  patch: Partial<{
    status: RunStatus;
    plannedTotalCents: number | null;
    cartTotalCents: number | null;
    orderReference: string | null;
    deliverySlot: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    finishedAt: string | null;
  }>,
): void {
  const current = get<RunRow>('SELECT * FROM order_runs WHERE id = ?', runId);
  if (!current) return;
  run(
    `UPDATE order_runs SET status = ?, planned_total_cents = ?, cart_total_cents = ?,
            order_reference = ?, delivery_slot = ?, error_code = ?, error_message = ?, finished_at = ?
     WHERE id = ?`,
    patch.status ?? current.status,
    patch.plannedTotalCents === undefined ? current.planned_total_cents : patch.plannedTotalCents,
    patch.cartTotalCents === undefined ? current.cart_total_cents : patch.cartTotalCents,
    patch.orderReference === undefined ? current.order_reference : patch.orderReference,
    patch.deliverySlot === undefined ? current.delivery_slot : patch.deliverySlot,
    patch.errorCode === undefined ? current.error_code : patch.errorCode,
    patch.errorMessage === undefined ? current.error_message : patch.errorMessage,
    patch.finishedAt === undefined ? current.finished_at : patch.finishedAt,
    runId,
  );
}

export function addRunItem(
  runId: string,
  item: {
    planItemId: string | null;
    label: string;
    requestedQty: number;
    orderedQty: number;
    unitPriceCents: number | null;
    totalCents: number | null;
    status: RunItemStatus;
    message?: string | null;
  },
): void {
  run(
    `INSERT INTO order_run_items (id, run_id, plan_item_id, label, requested_qty, ordered_qty,
            unit_price_cents, total_cents, status, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId('ritem'),
    runId,
    item.planItemId,
    item.label,
    item.requestedQty,
    item.orderedQty,
    item.unitPriceCents,
    item.totalCents,
    item.status,
    item.message ?? null,
  );
}

export function addRunLog(
  runId: string,
  level: RunLogEntry['level'],
  message: string,
  data?: unknown,
): void {
  run(
    'INSERT INTO run_logs (run_id, ts, level, message, data) VALUES (?, ?, ?, ?, ?)',
    runId,
    nowIso(),
    level,
    message,
    data === undefined ? null : JSON.stringify(data),
  );
}

export function addRunArtifact(
  runId: string,
  kind: RunArtifact['kind'],
  filePath: string,
  label?: string,
): void {
  run(
    'INSERT INTO run_artifacts (id, run_id, kind, path, label, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId('art'),
    runId,
    kind,
    filePath,
    label ?? null,
    nowIso(),
  );
}

export function listRuns(userId: string, options: { planId?: string; limit?: number } = {}): OrderRun[] {
  const limit = options.limit ?? 50;
  const rows = options.planId
    ? all<RunRow>(
        'SELECT * FROM order_runs WHERE user_id = ? AND plan_id = ? ORDER BY started_at DESC LIMIT ?',
        userId,
        options.planId,
        limit,
      )
    : all<RunRow>(
        'SELECT * FROM order_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?',
        userId,
        limit,
      );
  return rows.map(mapRun);
}

export function getRun(userId: string, runId: string): OrderRun | undefined {
  const row = get<RunRow>('SELECT * FROM order_runs WHERE id = ? AND user_id = ?', runId, userId);
  if (!row) return undefined;
  return {
    ...mapRun(row),
    items: listRunItems(runId),
    logs: listRunLogs(runId),
    artifacts: listRunArtifacts(runId),
  };
}

export function listRunItems(runId: string): OrderRunItem[] {
  return all<{
    id: string;
    run_id: string;
    plan_item_id: string | null;
    label: string;
    requested_qty: number;
    ordered_qty: number;
    unit_price_cents: number | null;
    total_cents: number | null;
    status: RunItemStatus;
    message: string | null;
  }>('SELECT * FROM order_run_items WHERE run_id = ? ORDER BY rowid', runId).map((row) => ({
    id: row.id,
    runId: row.run_id,
    planItemId: row.plan_item_id,
    label: row.label,
    requestedQty: row.requested_qty,
    orderedQty: row.ordered_qty,
    unitPriceCents: row.unit_price_cents,
    totalCents: row.total_cents,
    status: row.status,
    message: row.message,
  }));
}

export function listRunLogs(runId: string, afterId = 0): RunLogEntry[] {
  return all<{ id: number; ts: string; level: RunLogEntry['level']; message: string; data: string | null }>(
    'SELECT id, ts, level, message, data FROM run_logs WHERE run_id = ? AND id > ? ORDER BY id',
    runId,
    afterId,
  ).map((row) => ({
    id: row.id,
    ts: row.ts,
    level: row.level,
    message: row.message,
    data: row.data ? (JSON.parse(row.data) as unknown) : null,
  }));
}

export function listRunArtifacts(runId: string): RunArtifact[] {
  return all<{
    id: string;
    run_id: string;
    kind: RunArtifact['kind'];
    path: string;
    label: string | null;
    created_at: string;
  }>('SELECT * FROM run_artifacts WHERE run_id = ? ORDER BY created_at', runId).map((row) => ({
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    path: row.path,
    label: row.label,
    createdAt: row.created_at,
  }));
}

/** Laeufe, die beim letzten Absturz haengen geblieben sind, aufraeumen. */
export function failStaleRuns(): number {
  const stale = all<{ id: string }>(
    "SELECT id FROM order_runs WHERE status IN ('queued','running')",
  );
  for (const row of stale) {
    updateRun(row.id, {
      status: 'failed',
      errorCode: 'interrupted',
      errorMessage: 'Lauf wurde durch einen Neustart des Dienstes unterbrochen.',
      finishedAt: nowIso(),
    });
  }
  return stale.length;
}

export function runStats(userId: string): {
  total: number;
  success: number;
  failed: number;
  last30DaysCents: number;
} {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const total = get<{ n: number }>('SELECT COUNT(*) AS n FROM order_runs WHERE user_id = ?', userId)?.n ?? 0;
  const success =
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM order_runs WHERE user_id = ? AND status IN ('success','partial')",
      userId,
    )?.n ?? 0;
  const failed =
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM order_runs WHERE user_id = ? AND status = 'failed'",
      userId,
    )?.n ?? 0;
  const spent =
    get<{ s: number | null }>(
      `SELECT SUM(cart_total_cents) AS s FROM order_runs
       WHERE user_id = ? AND dry_run = 0 AND status IN ('success','partial') AND started_at >= ?`,
      userId,
      since,
    )?.s ?? 0;
  return { total, success, failed, last30DaysCents: spent ?? 0 };
}
