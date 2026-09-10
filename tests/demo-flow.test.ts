/**
 * End-to-End ueber den Demo-Shop: Konto -> Shop -> Bestellplan -> Lauf.
 * Laeuft ohne Netzwerk und ohne Browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'autohouse-test-'));
process.env.DATABASE_FILE = path.join(workDir, 'test.db');
process.env.ARTIFACT_DIR = path.join(workDir, 'runs');
process.env.STATE_DIR = path.join(workDir, 'state');
process.env.ENCRYPTION_KEY = '11'.repeat(32);
process.env.ALLOW_REAL_ORDERS = 'true';
process.env.SCHEDULER_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';

const { db, closeDb } = await import('../src/db/index.ts');
const { createUser } = await import('../src/db/repo/users.ts');
const { createShop } = await import('../src/db/repo/shops.ts');
const { createPlan } = await import('../src/db/repo/plans.ts');
const { getRun } = await import('../src/db/repo/runs.ts');
const { enqueueRun, waitForIdle } = await import('../src/scheduler/queue.ts');

test.after(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

test('Bestellplan laeuft komplett durch und haelt das Budget ein', async () => {
  db();
  const user = createUser('test@example.invalid', 'ein-langes-passwort');
  const shop = createShop(user.id, { provider: 'demo', name: 'Demo-Shop' });

  const plan = createPlan(user.id, {
    shopId: shop.id,
    name: 'Wocheneinkauf',
    intervalUnit: 'week',
    intervalValue: 1,
    weekday: 2,
    timeOfDay: '08:00',
    maxTotalCents: 500,
    dryRun: false,
    confirmOrder: true,
    items: [
      { externalId: 'demo-milch', label: 'Vollmilch', quantity: 2, priority: 90 },
      { externalId: 'demo-brot', label: 'Roggenbrot', quantity: 1, priority: 80 },
      { externalId: 'demo-kaffee', label: 'Kaffee', quantity: 1, priority: 10, optional: true },
    ],
  });

  assert.ok(plan.nextRunAt, 'Der naechste Termin wird beim Anlegen berechnet.');

  const run = enqueueRun({ planId: plan.id, userId: user.id, trigger: 'manual' });
  assert.ok(run);
  await waitForIdle(60_000);

  const finished = getRun(user.id, run.id);
  assert.ok(finished);
  assert.equal(finished.status, 'success');
  assert.equal(finished.dryRun, false);
  assert.ok(finished.orderReference?.startsWith('DEMO-'));

  const items = new Map((finished.items ?? []).map((item) => [item.label, item]));
  assert.equal(items.get('Frische Vollmilch 3,8 %')?.status, 'ordered');
  assert.equal(items.get('Frische Vollmilch 3,8 %')?.orderedQty, 2);
  assert.equal(items.get('Roggenmischbrot geschnitten')?.status, 'ordered');
  assert.equal(
    items.get('Kaffee ganze Bohne')?.status,
    'budget_skip',
    'Der optionale Kaffee sprengt das Budget und faellt raus.',
  );

  // 2 x 1,19 € + 1 x 1,89 € = 4,27 €
  assert.equal(finished.cartTotalCents, 427);
  assert.ok(finished.cartTotalCents! <= plan.maxTotalCents);
  assert.ok((finished.logs ?? []).length > 0, 'Der Lauf wird protokolliert.');
});

test('ohne Bestellbestaetigung bleibt es beim Testlauf', async () => {
  db();
  const user = createUser('test2@example.invalid', 'ein-langes-passwort');
  const shop = createShop(user.id, { provider: 'demo', name: 'Demo-Shop 2' });
  const plan = createPlan(user.id, {
    shopId: shop.id,
    name: 'Nur Testlauf',
    intervalUnit: 'day',
    intervalValue: 1,
    timeOfDay: '08:00',
    maxTotalCents: 5000,
    dryRun: true,
    confirmOrder: false,
    items: [{ externalId: 'demo-butter', label: 'Butter', quantity: 1 }],
  });

  const run = enqueueRun({ planId: plan.id, userId: user.id, trigger: 'manual' })!;
  await waitForIdle(60_000);

  const finished = getRun(user.id, run.id)!;
  assert.equal(finished.status, 'success');
  assert.equal(finished.dryRun, true);
  assert.equal(finished.orderReference, null, 'Im Testlauf wird nichts bestellt.');
  assert.equal(finished.cartTotalCents, 229);
});

test('Mindestbestellwert verhindert die Bestellung', async () => {
  db();
  const user = createUser('test3@example.invalid', 'ein-langes-passwort');
  const shop = createShop(user.id, { provider: 'demo', name: 'Demo-Shop 3' });
  const plan = createPlan(user.id, {
    shopId: shop.id,
    name: 'Zu kleiner Korb',
    intervalUnit: 'day',
    intervalValue: 1,
    timeOfDay: '08:00',
    maxTotalCents: 5000,
    minTotalCents: 3000,
    dryRun: false,
    confirmOrder: true,
    items: [{ externalId: 'demo-nudeln', label: 'Nudeln', quantity: 1 }],
  });

  const run = enqueueRun({ planId: plan.id, userId: user.id, trigger: 'manual' })!;
  await waitForIdle(60_000);

  const finished = getRun(user.id, run.id)!;
  assert.equal(finished.status, 'needs_action');
  assert.equal(finished.errorCode, 'minimum_order');
  assert.equal(finished.orderReference, null);
});
