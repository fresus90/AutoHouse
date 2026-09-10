import { config } from '../config.js';
import { nowIso } from '../db/index.js';
import { touchPlanLastRun } from '../db/repo/plans.js';
import { upsertProduct } from '../db/repo/products.js';
import { getCredentials, setConnectionStatus } from '../db/repo/shops.js';
import { addRunItem, updateRun } from '../db/repo/runs.js';
import type { OrderPlan, RunStatus, Shop } from '../core/types.js';
import { planWithinBudget, type ResolvedItem } from './budget.js';
import { withDriverContext } from './context.js';
import { errorMessage, formatCents } from './util.js';
import type {
  DeliverySlot,
  DeliveryWish,
  DriverContext,
  OrderItemRequest,
  OrderRequest,
  ProductCandidate,
  ShopDriver,
} from './types.js';

export interface RunOutcome {
  status: RunStatus;
  cartTotalCents: number | null;
  orderReference: string | null;
  message: string | null;
}

/** Aus einem Bestellplan wird die Anfrage, die der Treiber abarbeitet. */
export function buildOrderRequest(plan: OrderPlan): OrderRequest {
  const items: OrderItemRequest[] = (plan.items ?? []).map((item) => ({
    planItemId: item.id,
    label: item.label,
    externalId: item.externalId,
    searchTerm: item.searchTerm,
    quantity: item.quantity,
    maxUnitPriceCents: item.maxUnitPriceCents,
    priority: item.priority,
    optional: item.optional,
    allowSubstitute: item.allowSubstitute,
  }));
  return {
    items,
    maxTotalCents: plan.maxTotalCents,
    minTotalCents: plan.minTotalCents,
    budgetStrategy: plan.budgetStrategy,
    delivery: {
      preference: plan.deliveryPreference,
      weekday: plan.deliveryWeekday,
      from: plan.deliveryFrom,
      to: plan.deliveryTo,
    },
    // Doppelte Sicherung: Plan-Einstellung UND globaler Schalter muessen passen.
    confirmOrder: plan.confirmOrder && config.allowRealOrders && !plan.dryRun,
  };
}

/**
 * Fuehrt einen Bestellplan aus.
 *
 * Die Reihenfolge ist bewusst konservativ: erst alles aufloesen und rechnen,
 * dann den Warenkorb fuellen, dann erneut gegen das Budget pruefen und erst
 * ganz zum Schluss – wenn ueberhaupt – kostenpflichtig bestellen.
 */
export async function executeRun(params: {
  runId: string;
  plan: OrderPlan;
  shop: Shop;
}): Promise<RunOutcome> {
  const { runId, plan, shop } = params;
  const request = buildOrderRequest(plan);
  const dryRun = !request.confirmOrder;

  updateRun(runId, { status: 'running' });

  try {
    return await withDriverContext({ shop, runId, dryRun }, async (driver, ctx) => {
      ctx.log.info(
        `Starte Bestellplan "${plan.name}" bei ${shop.name} ` +
          `(${dryRun ? 'Testlauf – es wird nichts bestellt' : 'ECHTE Bestellung'}).`,
      );

      await driver.prepare(ctx);
      const loggedIn = await ensureLogin(driver, ctx, shop);
      if (!loggedIn.ok) {
        const status: RunStatus = loggedIn.needsManualAction ? 'needs_action' : 'failed';
        finish(runId, plan.id, status, {
          errorCode: 'login',
          errorMessage: loggedIn.message ?? 'Anmeldung fehlgeschlagen.',
        });
        return {
          status,
          cartTotalCents: null,
          orderReference: null,
          message: loggedIn.message ?? null,
        };
      }

      // --- 1. Artikel aufloesen ------------------------------------------------
      const resolved = await resolveItems(driver, ctx, shop, request);

      // --- 2. Budget rechnen ---------------------------------------------------
      const budget = planWithinBudget(resolved, {
        maxTotalCents: request.maxTotalCents,
        strategy: request.budgetStrategy,
      });
      updateRun(runId, { plannedTotalCents: budget.totalCents });
      ctx.log.info(
        `Geplante Summe: ${formatCents(budget.totalCents)} von maximal ${formatCents(request.maxTotalCents)}.`,
      );

      if (budget.aborted) {
        writeItems(runId, budget.lines);
        finish(runId, plan.id, 'failed', {
          errorCode: 'budget',
          errorMessage: budget.abortReason ?? 'Budget nicht ausreichend.',
        });
        return { status: 'failed', cartTotalCents: null, orderReference: null, message: budget.abortReason };
      }

      const toOrder = budget.lines.filter((line) => line.status === 'ordered');
      if (toOrder.length === 0) {
        writeItems(runId, budget.lines);
        finish(runId, plan.id, 'needs_action', {
          errorCode: 'no_items',
          errorMessage: 'Kein Artikel konnte eingeplant werden.',
        });
        return {
          status: 'needs_action',
          cartTotalCents: 0,
          orderReference: null,
          message: 'Kein Artikel konnte eingeplant werden.',
        };
      }

      // --- 3. Warenkorb fuellen ------------------------------------------------
      ctx.log.info('Leere den Warenkorb, um Reste aus frueheren Laeufen auszuschliessen.');
      await driver.clearCart(ctx);

      for (const line of toOrder) {
        const externalId = line.product?.externalId;
        if (!externalId) continue;
        const cartLine = await driver.addToCart(ctx, externalId, line.quantity);
        if (!cartLine) {
          line.status = 'unavailable';
          line.message = 'Konnte nicht in den Warenkorb gelegt werden.';
          continue;
        }
        // Der Warenkorb ist die Wahrheit – Preise von dort uebernehmen.
        if (cartLine.unitPriceCents !== null) {
          line.unitPriceCents = cartLine.unitPriceCents;
          line.totalCents = cartLine.unitPriceCents * line.quantity;
        }
        ctx.log.info(
          `In den Warenkorb: ${line.quantity} x ${line.request.label} ` +
            `(${formatCents(line.unitPriceCents)} / Stueck)`,
        );
      }

      const cart = await driver.readCart(ctx);
      updateRun(runId, { cartTotalCents: cart.totalCents });
      ctx.log.info(`Warenkorb-Summe laut Shop: ${formatCents(cart.totalCents)}`);

      // --- 4. Sicherheitspruefungen -------------------------------------------
      if (cart.totalCents > request.maxTotalCents) {
        writeItems(runId, budget.lines);
        await ctx.capture('budget-ueberschritten');
        const message =
          `Warenkorb (${formatCents(cart.totalCents)}) liegt ueber dem Limit ` +
          `(${formatCents(request.maxTotalCents)}). Es wurde nichts bestellt.`;
        ctx.log.error(message);
        finish(runId, plan.id, 'needs_action', { errorCode: 'budget_exceeded', errorMessage: message });
        return { status: 'needs_action', cartTotalCents: cart.totalCents, orderReference: null, message };
      }

      const minimum = Math.max(request.minTotalCents, cart.minimumOrderCents ?? 0);
      if (minimum > 0 && cart.totalCents < minimum) {
        writeItems(runId, budget.lines);
        const message =
          `Mindestbestellwert von ${formatCents(minimum)} nicht erreicht ` +
          `(${formatCents(cart.totalCents)}). Es wurde nichts bestellt.`;
        ctx.log.warn(message);
        finish(runId, plan.id, 'needs_action', { errorCode: 'minimum_order', errorMessage: message });
        return { status: 'needs_action', cartTotalCents: cart.totalCents, orderReference: null, message };
      }

      // --- 5. Lieferzeitfenster ------------------------------------------------
      let deliverySlot: DeliverySlot | null = null;
      if (driver.supportsDeliverySlots && driver.listDeliverySlots && driver.chooseDeliverySlot) {
        const slots = await driver.listDeliverySlots(ctx);
        deliverySlot = pickDeliverySlot(slots, request.delivery);
        if (deliverySlot) {
          if (!dryRun) await driver.chooseDeliverySlot(ctx, deliverySlot);
          updateRun(runId, { deliverySlot: deliverySlot.label });
          ctx.log.info(
            `Lieferzeitfenster: ${deliverySlot.label}${dryRun ? ' (im Testlauf nur vorgemerkt)' : ''}`,
          );
        } else if (slots.length === 0) {
          ctx.log.warn('Keine Lieferzeitfenster verfuegbar.');
        } else {
          ctx.log.warn('Kein Zeitfenster passt zum Wunsch – bitte Plan pruefen.');
        }
      }

      writeItems(runId, budget.lines);

      // --- 6. Bestellen (oder eben nicht) -------------------------------------
      if (dryRun) {
        const reason = !config.allowRealOrders
          ? 'ALLOW_REAL_ORDERS ist aus'
          : plan.dryRun
            ? 'der Plan ist als Testlauf markiert'
            : 'die Bestellbestaetigung ist im Plan nicht aktiviert';
        const message = `Testlauf beendet: Warenkorb steht bereit, es wurde nichts bestellt (${reason}).`;
        ctx.log.info(message);
        await ctx.capture('warenkorb-testlauf');
        const status: RunStatus = budget.requiredDropped ? 'partial' : 'success';
        finish(runId, plan.id, status, { errorMessage: null });
        return { status, cartTotalCents: cart.totalCents, orderReference: null, message };
      }

      const { reference } = await driver.placeOrder(ctx);
      const status: RunStatus = budget.requiredDropped ? 'partial' : 'success';
      finish(runId, plan.id, status, { orderReference: reference });
      ctx.log.info(`Bestellung abgeschickt. Referenz: ${reference ?? 'unbekannt'}`);
      return {
        status,
        cartTotalCents: cart.totalCents,
        orderReference: reference,
        message: 'Bestellung abgeschickt.',
      };
    });
  } catch (error) {
    const message = errorMessage(error);
    finish(runId, plan.id, 'failed', { errorCode: 'exception', errorMessage: message });
    return { status: 'failed', cartTotalCents: null, orderReference: null, message };
  }
}

// ---------------------------------------------------------------------------

async function ensureLogin(
  driver: ShopDriver,
  ctx: DriverContext,
  shop: Shop,
): Promise<{ ok: boolean; message?: string; needsManualAction?: boolean }> {
  if (await driver.isLoggedIn(ctx)) {
    ctx.log.info('Bestehende Session ist gueltig – kein Login noetig.');
    setConnectionStatus(shop.id, 'ok', 'Session gueltig.');
    return { ok: true };
  }
  const credentials = getCredentials(shop.id);
  if (!credentials) {
    const message =
      'Keine Zugangsdaten hinterlegt und keine gueltige Session. Bitte im Shop-Bereich hinterlegen ' +
      'oder einmalig ueber "npm run shop:login" anmelden.';
    setConnectionStatus(shop.id, 'error', message);
    return { ok: false, message, needsManualAction: true };
  }
  const result = await driver.login(ctx, credentials);
  setConnectionStatus(shop.id, result.ok ? 'ok' : 'error', result.message ?? null);
  return result.ok
    ? { ok: true }
    : {
        ok: false,
        ...(result.message === undefined ? {} : { message: result.message }),
        ...(result.needsManualAction === undefined ? {} : { needsManualAction: result.needsManualAction }),
      };
}

async function resolveItems(
  driver: ShopDriver,
  ctx: DriverContext,
  shop: Shop,
  request: OrderRequest,
): Promise<ResolvedItem[]> {
  const resolved: ResolvedItem[] = [];
  for (const item of request.items) {
    let product: ProductCandidate | null = null;
    try {
      if (item.externalId) {
        product = await driver.getProduct(ctx, item.externalId);
      }
      if (!product) {
        const query = item.searchTerm ?? item.label;
        const hits = await driver.searchProducts(ctx, query, 5);
        const usable = hits.filter((hit) => hit.available !== false);
        // Ohne Ersatzartikel-Freigabe nur uebernehmen, wenn die ID passt.
        product = item.allowSubstitute || !item.externalId ? (usable[0] ?? null) : null;
        if (product && item.externalId && product.externalId !== item.externalId) {
          ctx.log.warn(`Ersatzartikel fuer "${item.label}": ${product.name}`);
        }
      }
    } catch (error) {
      ctx.log.warn(`Artikel "${item.label}" konnte nicht aufgeloest werden: ${errorMessage(error)}`);
      product = null;
    }

    if (product) {
      // Treffer im Katalog merken, damit die Oberflaeche Preise anzeigen kann.
      upsertProduct(shop.id, {
        externalId: product.externalId,
        name: product.name,
        brand: product.brand ?? null,
        grammage: product.grammage ?? null,
        priceCents: product.priceCents ?? null,
        basePrice: product.basePrice ?? null,
        imageUrl: product.imageUrl ?? null,
        productUrl: product.productUrl ?? null,
      });
      ctx.log.debug(`Aufgeloest: ${item.label} -> ${product.name} (${formatCents(product.priceCents)})`);
    } else {
      ctx.log.warn(`Kein Treffer fuer "${item.label}".`);
    }

    resolved.push({ request: item, product, unitPriceCents: product?.priceCents ?? null });
  }
  return resolved;
}

export function pickDeliverySlot(slots: DeliverySlot[], wish: DeliveryWish): DeliverySlot | null {
  const available = slots.filter((slot) => slot.available);
  if (available.length === 0) return null;

  const matchesWish = (slot: DeliverySlot): boolean => {
    if (wish.weekday !== null && wish.weekday !== undefined) {
      const date = new Date(slot.start);
      if (!Number.isNaN(date.getTime()) && date.getDay() !== wish.weekday) return false;
    }
    if (wish.from && timePart(slot.start) < wish.from) return false;
    if (wish.to && timePart(slot.end) > wish.to) return false;
    return true;
  };

  // "fixed" heisst: nur ein passendes Fenster, sonst lieber keines.
  const matching = available.filter(matchesWish);
  const candidates = matching.length > 0 ? matching : wish.preference === 'fixed' ? [] : available;
  if (candidates.length === 0) return null;

  if (wish.preference === 'cheapest') {
    return [...candidates].sort(
      (a, b) => (a.priceCents ?? Number.MAX_SAFE_INTEGER) - (b.priceCents ?? Number.MAX_SAFE_INTEGER),
    )[0]!;
  }
  return [...candidates].sort((a, b) => a.start.localeCompare(b.start))[0]!;
}

function timePart(isoLike: string): string {
  const match = /T(\d{2}:\d{2})/.exec(isoLike);
  return match?.[1] ?? '00:00';
}

function writeItems(runId: string, lines: ReturnType<typeof planWithinBudget>['lines']): void {
  for (const line of lines) {
    addRunItem(runId, {
      planItemId: line.request.planItemId,
      label: line.product?.name ?? line.request.label,
      requestedQty: line.request.quantity,
      orderedQty: line.status === 'ordered' ? line.quantity : 0,
      unitPriceCents: line.unitPriceCents,
      totalCents: line.status === 'ordered' ? line.totalCents : 0,
      status: line.status,
      message: line.message,
    });
  }
}

function finish(
  runId: string,
  planId: string,
  status: RunStatus,
  patch: Partial<{ errorCode: string | null; errorMessage: string | null; orderReference: string | null }>,
): void {
  updateRun(runId, { status, finishedAt: nowIso(), ...patch });
  // Der naechste Termin wird beim Einplanen gesetzt, nicht hier – ein manuell
  // gestarteter Lauf soll den Rhythmus nicht verschieben.
  touchPlanLastRun(planId);
}
