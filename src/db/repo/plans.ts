import { all, get, nowIso, run, toBool, toInt, tx } from '../index.js';
import { newId } from '../../core/crypto.js';
import { computeNextRun } from '../../core/schedule.js';
import type { BudgetStrategy, DeliveryPreference, OrderPlan, OrderPlanItem } from '../../core/types.js';

interface PlanRow {
  id: string;
  user_id: string;
  shop_id: string;
  name: string;
  enabled: number;
  interval_unit: 'day' | 'week' | 'month';
  interval_value: number;
  weekday: number | null;
  day_of_month: number | null;
  time_of_day: string;
  start_date: string | null;
  max_total_cents: number;
  min_total_cents: number;
  budget_strategy: BudgetStrategy;
  delivery_preference: DeliveryPreference;
  delivery_weekday: number | null;
  delivery_from: string | null;
  delivery_to: string | null;
  dry_run: number;
  confirm_order: number;
  notes: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  plan_id: string;
  product_id: string | null;
  external_id: string | null;
  search_term: string | null;
  label: string;
  quantity: number;
  max_unit_price_cents: number | null;
  priority: number;
  optional: number;
  allow_substitute: number;
  position: number;
}

const mapItem = (row: ItemRow): OrderPlanItem => ({
  id: row.id,
  planId: row.plan_id,
  productId: row.product_id,
  externalId: row.external_id,
  searchTerm: row.search_term,
  label: row.label,
  quantity: row.quantity,
  maxUnitPriceCents: row.max_unit_price_cents,
  priority: row.priority,
  optional: toBool(row.optional),
  allowSubstitute: toBool(row.allow_substitute),
  position: row.position,
});

const mapPlan = (row: PlanRow): OrderPlan => ({
  id: row.id,
  userId: row.user_id,
  shopId: row.shop_id,
  name: row.name,
  enabled: toBool(row.enabled),
  intervalUnit: row.interval_unit,
  intervalValue: row.interval_value,
  weekday: row.weekday,
  dayOfMonth: row.day_of_month,
  timeOfDay: row.time_of_day,
  startDate: row.start_date,
  maxTotalCents: row.max_total_cents,
  minTotalCents: row.min_total_cents,
  budgetStrategy: row.budget_strategy,
  deliveryPreference: row.delivery_preference,
  deliveryWeekday: row.delivery_weekday,
  deliveryFrom: row.delivery_from,
  deliveryTo: row.delivery_to,
  dryRun: toBool(row.dry_run),
  confirmOrder: toBool(row.confirm_order),
  notes: row.notes,
  lastRunAt: row.last_run_at,
  nextRunAt: row.next_run_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface PlanItemInput {
  productId?: string | null;
  externalId?: string | null;
  searchTerm?: string | null;
  label: string;
  quantity: number;
  maxUnitPriceCents?: number | null;
  priority?: number;
  optional?: boolean;
  allowSubstitute?: boolean;
}

export interface PlanInput {
  shopId: string;
  name: string;
  enabled?: boolean;
  intervalUnit: 'day' | 'week' | 'month';
  intervalValue: number;
  weekday?: number | null;
  dayOfMonth?: number | null;
  timeOfDay: string;
  startDate?: string | null;
  maxTotalCents: number;
  minTotalCents?: number;
  budgetStrategy?: BudgetStrategy;
  deliveryPreference?: DeliveryPreference;
  deliveryWeekday?: number | null;
  deliveryFrom?: string | null;
  deliveryTo?: string | null;
  dryRun?: boolean;
  confirmOrder?: boolean;
  notes?: string | null;
  items: PlanItemInput[];
}

export function listPlans(userId: string, shopId?: string): OrderPlan[] {
  const rows = shopId
    ? all<PlanRow>(
        'SELECT * FROM order_plans WHERE user_id = ? AND shop_id = ? ORDER BY created_at',
        userId,
        shopId,
      )
    : all<PlanRow>('SELECT * FROM order_plans WHERE user_id = ? ORDER BY created_at', userId);
  return rows.map((row) => ({ ...mapPlan(row), items: listPlanItems(row.id) }));
}

export function getPlan(userId: string, planId: string): OrderPlan | undefined {
  const row = get<PlanRow>('SELECT * FROM order_plans WHERE id = ? AND user_id = ?', planId, userId);
  return row ? { ...mapPlan(row), items: listPlanItems(row.id) } : undefined;
}

export function getPlanById(planId: string): OrderPlan | undefined {
  const row = get<PlanRow>('SELECT * FROM order_plans WHERE id = ?', planId);
  return row ? { ...mapPlan(row), items: listPlanItems(row.id) } : undefined;
}

export function listPlanItems(planId: string): OrderPlanItem[] {
  return all<ItemRow>(
    'SELECT * FROM order_plan_items WHERE plan_id = ? ORDER BY position, rowid',
    planId,
  ).map(mapItem);
}

function nextRunFor(input: {
  intervalUnit: 'day' | 'week' | 'month';
  intervalValue: number;
  weekday?: number | null;
  dayOfMonth?: number | null;
  timeOfDay: string;
  startDate?: string | null;
}): string | null {
  const next = computeNextRun({
    intervalUnit: input.intervalUnit,
    intervalValue: input.intervalValue,
    weekday: input.weekday ?? null,
    dayOfMonth: input.dayOfMonth ?? null,
    timeOfDay: input.timeOfDay,
    startDate: input.startDate ?? null,
  });
  return next ? next.toISOString() : null;
}

export function createPlan(userId: string, input: PlanInput): OrderPlan {
  const id = newId('plan');
  const ts = nowIso();
  tx(() => {
    run(
      `INSERT INTO order_plans (
         id, user_id, shop_id, name, enabled, interval_unit, interval_value, weekday, day_of_month,
         time_of_day, start_date, max_total_cents, min_total_cents, budget_strategy,
         delivery_preference, delivery_weekday, delivery_from, delivery_to,
         dry_run, confirm_order, notes, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      input.shopId,
      input.name,
      toInt(input.enabled ?? true),
      input.intervalUnit,
      input.intervalValue,
      input.weekday ?? null,
      input.dayOfMonth ?? null,
      input.timeOfDay,
      input.startDate ?? null,
      input.maxTotalCents,
      input.minTotalCents ?? 0,
      input.budgetStrategy ?? 'drop_optional',
      input.deliveryPreference ?? 'earliest',
      input.deliveryWeekday ?? null,
      input.deliveryFrom ?? null,
      input.deliveryTo ?? null,
      toInt(input.dryRun ?? true),
      toInt(input.confirmOrder ?? false),
      input.notes ?? null,
      nextRunFor(input),
      ts,
      ts,
    );
    replaceItems(id, input.items);
  });
  return getPlan(userId, id)!;
}

export function updatePlan(userId: string, planId: string, input: PlanInput): OrderPlan | undefined {
  const existing = getPlan(userId, planId);
  if (!existing) return undefined;
  tx(() => {
    run(
      `UPDATE order_plans SET shop_id = ?, name = ?, enabled = ?, interval_unit = ?, interval_value = ?,
              weekday = ?, day_of_month = ?, time_of_day = ?, start_date = ?, max_total_cents = ?,
              min_total_cents = ?, budget_strategy = ?, delivery_preference = ?, delivery_weekday = ?,
              delivery_from = ?, delivery_to = ?, dry_run = ?, confirm_order = ?, notes = ?,
              next_run_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      input.shopId,
      input.name,
      toInt(input.enabled ?? true),
      input.intervalUnit,
      input.intervalValue,
      input.weekday ?? null,
      input.dayOfMonth ?? null,
      input.timeOfDay,
      input.startDate ?? null,
      input.maxTotalCents,
      input.minTotalCents ?? 0,
      input.budgetStrategy ?? 'drop_optional',
      input.deliveryPreference ?? 'earliest',
      input.deliveryWeekday ?? null,
      input.deliveryFrom ?? null,
      input.deliveryTo ?? null,
      toInt(input.dryRun ?? true),
      toInt(input.confirmOrder ?? false),
      input.notes ?? null,
      (input.enabled ?? true) ? nextRunFor(input) : null,
      nowIso(),
      planId,
      userId,
    );
    replaceItems(planId, input.items);
  });
  return getPlan(userId, planId);
}

function replaceItems(planId: string, items: PlanItemInput[]): void {
  run('DELETE FROM order_plan_items WHERE plan_id = ?', planId);
  items.forEach((item, index) => {
    run(
      `INSERT INTO order_plan_items (id, plan_id, product_id, external_id, search_term, label,
              quantity, max_unit_price_cents, priority, optional, allow_substitute, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId('item'),
      planId,
      item.productId ?? null,
      item.externalId ?? null,
      item.searchTerm ?? null,
      item.label,
      Math.max(1, item.quantity),
      item.maxUnitPriceCents ?? null,
      item.priority ?? 50,
      toInt(item.optional ?? false),
      toInt(item.allowSubstitute ?? false),
      index,
      nowIso(),
    );
  });
}

export function deletePlan(userId: string, planId: string): boolean {
  if (!getPlan(userId, planId)) return false;
  run('DELETE FROM order_plans WHERE id = ? AND user_id = ?', planId, userId);
  return true;
}

export function setPlanEnabled(userId: string, planId: string, enabled: boolean): OrderPlan | undefined {
  const plan = getPlan(userId, planId);
  if (!plan) return undefined;
  run(
    'UPDATE order_plans SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    toInt(enabled),
    enabled ? nextRunFor(plan) : null,
    nowIso(),
    planId,
    userId,
  );
  return getPlan(userId, planId);
}

/** Plaene, deren Termin erreicht ist. */
export function findDuePlans(now: Date = new Date()): OrderPlan[] {
  return all<PlanRow>(
    `SELECT * FROM order_plans
     WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
     ORDER BY next_run_at`,
    now.toISOString(),
  ).map((row) => ({ ...mapPlan(row), items: listPlanItems(row.id) }));
}

/** Nur den Zeitstempel des letzten Laufs setzen (aendert den Takt nicht). */
export function touchPlanLastRun(planId: string, ranAt: Date = new Date()): void {
  run(
    'UPDATE order_plans SET last_run_at = ?, updated_at = ? WHERE id = ?',
    ranAt.toISOString(),
    nowIso(),
    planId,
  );
}

/** Nach einem geplanten Lauf: Zeitstempel merken und naechsten Termin setzen. */
export function markPlanRun(planId: string, ranAt: Date = new Date()): void {
  const plan = getPlanById(planId);
  if (!plan) return;
  const next = computeNextRun(
    {
      intervalUnit: plan.intervalUnit,
      intervalValue: plan.intervalValue,
      weekday: plan.weekday,
      dayOfMonth: plan.dayOfMonth,
      timeOfDay: plan.timeOfDay,
      startDate: plan.startDate,
    },
    ranAt,
  );
  run(
    'UPDATE order_plans SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
    ranAt.toISOString(),
    plan.enabled && next ? next.toISOString() : null,
    nowIso(),
    planId,
  );
}
