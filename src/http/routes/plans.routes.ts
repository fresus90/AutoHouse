import { Router } from 'express';
import {
  createPlan,
  deletePlan,
  getPlan,
  listPlans,
  setPlanEnabled,
  updatePlan,
} from '../../db/repo/plans.js';
import { getShop } from '../../db/repo/shops.js';
import { getProduct, listProducts } from '../../db/repo/products.js';
import { planWithinBudget, type ResolvedItem } from '../../automation/budget.js';
import { enqueueRun, isPlanBusy } from '../../scheduler/queue.js';
import { computeNextRun, describeSchedule } from '../../core/schedule.js';
import { config } from '../../config.js';
import { asyncHandler, badRequest, conflict, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../auth.js';
import { planSchema } from '../validation.js';
import type { OrderPlan } from '../../core/types.js';

export const plansRouter = Router();
plansRouter.use(requireAuth);

/** Ergaenzt den Plan um abgeleitete Felder fuer die Oberflaeche. */
function decorate(plan: OrderPlan): OrderPlan & { scheduleLabel: string; busy: boolean } {
  return {
    ...plan,
    scheduleLabel: describeSchedule({
      intervalUnit: plan.intervalUnit,
      intervalValue: plan.intervalValue,
      weekday: plan.weekday,
      dayOfMonth: plan.dayOfMonth,
      timeOfDay: plan.timeOfDay,
      startDate: plan.startDate,
    }),
    busy: isPlanBusy(plan.id),
  };
}

plansRouter.get('/', (req, res) => {
  const shopId = typeof req.query.shopId === 'string' ? req.query.shopId : undefined;
  res.json({ plans: listPlans(currentUser(req).id, shopId).map(decorate) });
});

plansRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const payload = planSchema.parse(req.body);
    if (!getShop(user.id, payload.shopId)) throw badRequest('Der gewaehlte Shop existiert nicht.');
    if (payload.confirmOrder && !config.allowRealOrders) {
      // Kein Fehler – der Plan wird gespeichert, laeuft aber als Testlauf.
      res.setHeader('x-autohouse-warning', 'ALLOW_REAL_ORDERS ist aus; Plan laeuft als Testlauf.');
    }
    const plan = createPlan(user.id, payload);
    res.status(201).json({ plan: decorate(plan) });
  }),
);

plansRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const plan = getPlan(currentUser(req).id, req.params.id!);
    if (!plan) throw notFound('Bestellplan nicht gefunden.');
    res.json({ plan: decorate(plan) });
  }),
);

plansRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const payload = planSchema.parse(req.body);
    if (!getShop(user.id, payload.shopId)) throw badRequest('Der gewaehlte Shop existiert nicht.');
    const plan = updatePlan(user.id, req.params.id!, payload);
    if (!plan) throw notFound('Bestellplan nicht gefunden.');
    res.json({ plan: decorate(plan) });
  }),
);

plansRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!deletePlan(currentUser(req).id, req.params.id!)) throw notFound('Bestellplan nicht gefunden.');
    res.status(204).end();
  }),
);

plansRouter.post(
  '/:id/enabled',
  asyncHandler(async (req, res) => {
    const enabled = Boolean((req.body as { enabled?: unknown })?.enabled);
    const plan = setPlanEnabled(currentUser(req).id, req.params.id!, enabled);
    if (!plan) throw notFound('Bestellplan nicht gefunden.');
    res.json({ plan: decorate(plan) });
  }),
);

/** Manueller Start – haelt den regulaeren Takt unveraendert. */
plansRouter.post(
  '/:id/run',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const plan = getPlan(user.id, req.params.id!);
    if (!plan) throw notFound('Bestellplan nicht gefunden.');
    if (isPlanBusy(plan.id)) throw conflict('Fuer diesen Plan laeuft bereits eine Bestellung.');
    const run = enqueueRun({ planId: plan.id, userId: user.id, trigger: 'manual' });
    if (!run) throw conflict('Lauf konnte nicht eingeplant werden.');
    res.status(202).json({ run });
  }),
);

/**
 * Vorschau ohne Browser: rechnet mit den zuletzt bekannten Preisen aus dem
 * lokalen Katalog. Damit sieht man sofort, was das Budget hergibt.
 */
plansRouter.get(
  '/:id/preview',
  asyncHandler(async (req, res) => {
    const plan = getPlan(currentUser(req).id, req.params.id!);
    if (!plan) throw notFound('Bestellplan nicht gefunden.');

    const cached = listProducts(plan.shopId, undefined, 500);
    const byExternalId = new Map(cached.map((product) => [product.externalId, product]));

    const resolved: ResolvedItem[] = (plan.items ?? []).map((item) => {
      const product =
        (item.productId ? getProduct(item.productId) : undefined) ??
        (item.externalId ? byExternalId.get(item.externalId) : undefined) ??
        null;
      return {
        request: {
          planItemId: item.id,
          label: item.label,
          externalId: item.externalId,
          searchTerm: item.searchTerm,
          quantity: item.quantity,
          maxUnitPriceCents: item.maxUnitPriceCents,
          priority: item.priority,
          optional: item.optional,
          allowSubstitute: item.allowSubstitute,
        },
        product: product
          ? {
              externalId: product.externalId,
              name: product.name,
              priceCents: product.priceCents,
              productUrl: product.productUrl,
            }
          : null,
        unitPriceCents: product?.priceCents ?? null,
      };
    });

    const budget = planWithinBudget(resolved, {
      maxTotalCents: plan.maxTotalCents,
      strategy: plan.budgetStrategy,
    });

    res.json({
      preview: {
        totalCents: budget.totalCents,
        maxTotalCents: plan.maxTotalCents,
        minTotalCents: plan.minTotalCents,
        requiredDropped: budget.requiredDropped,
        aborted: budget.aborted,
        abortReason: budget.abortReason,
        lines: budget.lines.map((line) => ({
          label: line.product?.name ?? line.request.label,
          quantity: line.quantity,
          requestedQuantity: line.request.quantity,
          unitPriceCents: line.unitPriceCents,
          totalCents: line.totalCents,
          status: line.status,
          message: line.message,
          priceKnown: line.unitPriceCents !== null,
        })),
      },
      nextRunAt:
        computeNextRun({
          intervalUnit: plan.intervalUnit,
          intervalValue: plan.intervalValue,
          weekday: plan.weekday,
          dayOfMonth: plan.dayOfMonth,
          timeOfDay: plan.timeOfDay,
          startDate: plan.startDate,
        })?.toISOString() ?? null,
    });
  }),
);
