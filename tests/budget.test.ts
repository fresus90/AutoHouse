import assert from 'node:assert/strict';
import test from 'node:test';
import { planWithinBudget, type ResolvedItem } from '../src/automation/budget.ts';

function item(
  label: string,
  priceCents: number | null,
  overrides: Partial<ResolvedItem['request']> = {},
): ResolvedItem {
  return {
    request: {
      planItemId: label,
      label,
      externalId: label,
      searchTerm: null,
      quantity: 1,
      maxUnitPriceCents: null,
      priority: 50,
      optional: false,
      allowSubstitute: false,
      ...overrides,
    },
    product: priceCents === null ? null : { externalId: label, name: label, priceCents },
    unitPriceCents: priceCents,
  };
}

test('alles passt ins Budget', () => {
  const plan = planWithinBudget([item('Milch', 119), item('Brot', 189)], {
    maxTotalCents: 1000,
    strategy: 'drop_optional',
  });
  assert.equal(plan.totalCents, 308);
  assert.ok(plan.lines.every((line) => line.status === 'ordered'));
  assert.equal(plan.requiredDropped, false);
});

test('optionale Artikel fallen zuerst raus', () => {
  const plan = planWithinBudget(
    [item('Milch', 400), item('Luxus', 400, { optional: true }), item('Brot', 400)],
    { maxTotalCents: 900, strategy: 'drop_optional' },
  );
  const byLabel = new Map(plan.lines.map((line) => [line.request.label, line]));
  assert.equal(byLabel.get('Milch')!.status, 'ordered');
  assert.equal(byLabel.get('Brot')!.status, 'ordered');
  assert.equal(byLabel.get('Luxus')!.status, 'budget_skip');
  assert.equal(plan.totalCents, 800);
  assert.equal(plan.requiredDropped, false);
});

test('hoehere Prioritaet gewinnt bei knappem Budget', () => {
  const plan = planWithinBudget(
    [item('Unwichtig', 600, { priority: 10 }), item('Wichtig', 600, { priority: 90 })],
    { maxTotalCents: 700, strategy: 'drop_optional' },
  );
  const byLabel = new Map(plan.lines.map((line) => [line.request.label, line]));
  assert.equal(byLabel.get('Wichtig')!.status, 'ordered');
  assert.equal(byLabel.get('Unwichtig')!.status, 'budget_skip');
  assert.equal(plan.requiredDropped, true);
});

test('Strategie reduce_qty kuerzt die Menge', () => {
  const plan = planWithinBudget([item('Wasser', 100, { quantity: 10 })], {
    maxTotalCents: 450,
    strategy: 'reduce_qty',
  });
  assert.equal(plan.lines[0]!.status, 'ordered');
  assert.equal(plan.lines[0]!.quantity, 4);
  assert.equal(plan.totalCents, 400);
});

test('Strategie abort bricht ab, sobald etwas nicht passt', () => {
  const plan = planWithinBudget([item('Teuer', 5000)], { maxTotalCents: 1000, strategy: 'abort' });
  assert.equal(plan.aborted, true);
  assert.match(plan.abortReason ?? '', /Budget/);
});

test('Preisobergrenze pro Stueck wird eingehalten', () => {
  const plan = planWithinBudget([item('Butter', 299, { maxUnitPriceCents: 249 })], {
    maxTotalCents: 10_000,
    strategy: 'drop_optional',
  });
  assert.equal(plan.lines[0]!.status, 'too_expensive');
  assert.equal(plan.totalCents, 0);
});

test('nicht gefundene Artikel gelten als nicht verfuegbar', () => {
  const plan = planWithinBudget([item('Phantom', null)], {
    maxTotalCents: 10_000,
    strategy: 'drop_optional',
  });
  assert.equal(plan.lines[0]!.status, 'unavailable');
  assert.equal(plan.requiredDropped, true);
});

test('Reihenfolge der Ausgabe entspricht der Reihenfolge im Plan', () => {
  const plan = planWithinBudget(
    [item('A', 100, { priority: 1 }), item('B', 100, { priority: 99 })],
    { maxTotalCents: 10_000, strategy: 'drop_optional' },
  );
  assert.deepEqual(
    plan.lines.map((line) => line.request.label),
    ['A', 'B'],
  );
});
