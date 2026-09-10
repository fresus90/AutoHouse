import type { BudgetStrategy } from '../core/types.js';
import type { OrderItemRequest, ProductCandidate } from './types.js';

export interface ResolvedItem {
  request: OrderItemRequest;
  product: ProductCandidate | null;
  unitPriceCents: number | null;
}

export type PlannedStatus = 'ordered' | 'unavailable' | 'too_expensive' | 'budget_skip';

export interface PlannedLine {
  request: OrderItemRequest;
  product: ProductCandidate | null;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number;
  status: PlannedStatus;
  message: string | null;
}

export interface BudgetPlan {
  lines: PlannedLine[];
  /** Summe der Positionen mit status = 'ordered'. */
  totalCents: number;
  /** true, wenn eine Pflichtposition am Budget gescheitert ist. */
  requiredDropped: boolean;
  /** true, wenn wegen Strategie 'abort' gar nicht bestellt werden darf. */
  aborted: boolean;
  abortReason: string | null;
}

/**
 * Waehlt aus den aufgeloesten Positionen aus, was in das Budget passt.
 *
 * Reihenfolge: Pflichtpositionen vor optionalen, innerhalb der Gruppe nach
 * Prioritaet (hoeher zuerst), bei Gleichstand nach Reihenfolge im Plan.
 */
export function planWithinBudget(
  resolved: ResolvedItem[],
  options: { maxTotalCents: number; strategy: BudgetStrategy },
): BudgetPlan {
  const lines: PlannedLine[] = [];
  let total = 0;
  let requiredDropped = false;
  let aborted = false;
  let abortReason: string | null = null;

  const candidates = [...resolved].sort((a, b) => {
    if (a.request.optional !== b.request.optional) return a.request.optional ? 1 : -1;
    if (a.request.priority !== b.request.priority) return b.request.priority - a.request.priority;
    return 0;
  });

  for (const item of candidates) {
    const { request } = item;

    if (!item.product) {
      lines.push(line(item, 0, 'unavailable', 'Artikel im Shop nicht gefunden oder nicht lieferbar.'));
      if (!request.optional) requiredDropped = true;
      continue;
    }

    const unitPrice = item.unitPriceCents;
    if (unitPrice === null) {
      lines.push(line(item, 0, 'unavailable', 'Kein Preis ermittelbar.'));
      if (!request.optional) requiredDropped = true;
      continue;
    }

    if (request.maxUnitPriceCents !== null && unitPrice > request.maxUnitPriceCents) {
      lines.push(
        line(
          item,
          0,
          'too_expensive',
          `Stueckpreis ${(unitPrice / 100).toFixed(2)} € liegt ueber dem Limit von ${(
            request.maxUnitPriceCents / 100
          ).toFixed(2)} €.`,
        ),
      );
      continue;
    }

    const wanted = Math.max(1, request.quantity);
    const remaining = options.maxTotalCents - total;
    const fullCost = unitPrice * wanted;

    if (fullCost <= remaining) {
      total += fullCost;
      lines.push(line(item, wanted, 'ordered', null));
      continue;
    }

    if (options.strategy === 'abort') {
      aborted = true;
      abortReason = `Budget von ${(options.maxTotalCents / 100).toFixed(2)} € reicht nicht fuer "${request.label}".`;
      lines.push(line(item, 0, 'budget_skip', abortReason));
      if (!request.optional) requiredDropped = true;
      continue;
    }

    if (options.strategy === 'reduce_qty') {
      const affordable = Math.floor(remaining / unitPrice);
      if (affordable >= 1) {
        total += affordable * unitPrice;
        lines.push(
          line(item, affordable, 'ordered', `Menge wegen Budget von ${wanted} auf ${affordable} reduziert.`),
        );
        continue;
      }
    }

    lines.push(line(item, 0, 'budget_skip', 'Passt nicht mehr ins Budget.'));
    if (!request.optional) requiredDropped = true;
  }

  // Ausgabe in der urspruenglichen Plan-Reihenfolge, damit die UI stabil bleibt.
  const order = new Map(resolved.map((item, index) => [item.request, index]));
  lines.sort((a, b) => (order.get(a.request) ?? 0) - (order.get(b.request) ?? 0));

  return { lines, totalCents: total, requiredDropped, aborted, abortReason };
}

function line(
  item: ResolvedItem,
  quantity: number,
  status: PlannedStatus,
  message: string | null,
): PlannedLine {
  const unitPrice = item.unitPriceCents;
  return {
    request: item.request,
    product: item.product,
    quantity,
    unitPriceCents: unitPrice,
    totalCents: unitPrice !== null ? unitPrice * quantity : 0,
    status,
    message,
  };
}
