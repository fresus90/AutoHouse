/** Prueft Anmeldung, Zugriffsschutz und die wichtigsten API-Wege. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const workDir = mkdtempSync(path.join(tmpdir(), 'autohouse-api-'));
process.env.DATABASE_FILE = path.join(workDir, 'api.db');
process.env.ARTIFACT_DIR = path.join(workDir, 'runs');
process.env.STATE_DIR = path.join(workDir, 'state');
process.env.ENCRYPTION_KEY = '22'.repeat(32);
process.env.SCHEDULER_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';

const { createApp } = await import('../src/http/app.ts');
const { closeDb } = await import('../src/db/index.ts');

const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let cookie = '';

async function call(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

test('ohne Anmeldung ist die API gesperrt', async () => {
  const response = await call('GET', '/api/shops');
  assert.equal(response.status, 401);
});

test('erste Registrierung ist offen, danach nicht mehr', async () => {
  const state = await call('GET', '/api/auth/state');
  assert.equal(state.json.needsSetup, true);

  const created = await call('POST', '/api/auth/register', {
    email: 'chef@example.invalid',
    password: 'ein-sehr-langes-passwort',
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.user.email, 'chef@example.invalid');

  const savedCookie = cookie;
  cookie = '';
  const second = await call('POST', '/api/auth/register', {
    email: 'fremd@example.invalid',
    password: 'ein-sehr-langes-passwort',
  });
  assert.equal(second.status, 401);
  cookie = savedCookie;
});

test('zu kurze Passwoerter werden abgelehnt', async () => {
  const saved = cookie;
  cookie = '';
  const response = await call('POST', '/api/auth/login', { email: 'chef@example.invalid', password: 'x' });
  assert.equal(response.status, 401);
  cookie = saved;
});

test('Shop anlegen, Plan anlegen, Vorschau rechnen', async () => {
  const shop = await call('POST', '/api/shops', {
    provider: 'demo',
    name: 'Demo',
    credentials: { username: 'a@b.de', password: 'geheim' },
  });
  assert.equal(shop.status, 201);
  assert.equal(shop.json.shop.hasCredentials, true);
  assert.equal(shop.json.shop.provider, 'demo');
  // Geheimnisse duerfen die API nie verlassen.
  assert.equal(JSON.stringify(shop.json).includes('geheim'), false);

  const search = await call('POST', `/api/shops/${shop.json.shop.id}/search`, { query: 'milch' });
  assert.equal(search.status, 200);
  assert.ok(search.json.products.length > 0);

  // Die Vorschau rechnet mit dem lokalen Katalog – erst suchen, dann planen.
  await call('POST', `/api/shops/${shop.json.shop.id}/search`, { query: 'demo' });

  const plan = await call('POST', '/api/plans', {
    shopId: shop.json.shop.id,
    name: 'Wocheneinkauf',
    intervalUnit: 'week',
    intervalValue: 1,
    weekday: 2,
    timeOfDay: '08:00',
    maxTotalCents: 2000,
    items: [
      { externalId: 'demo-milch', label: 'Milch', quantity: 2 },
      { externalId: 'demo-kaffee', label: 'Kaffee', quantity: 1, optional: true, priority: 10 },
    ],
  });
  assert.equal(plan.status, 201);
  assert.equal(plan.json.plan.scheduleLabel, 'Jede Woche Dienstags um 08:00 Uhr');
  assert.ok(plan.json.plan.nextRunAt);

  const preview = await call('GET', `/api/plans/${plan.json.plan.id}/preview`);
  assert.equal(preview.status, 200);
  // 2 x 1,19 € + 14,99 € = 17,37 €
  assert.equal(preview.json.preview.totalCents, 1737);

  const runs = await call('GET', '/api/runs');
  assert.equal(runs.status, 200);
  assert.deepEqual(runs.json.runs, []);
});

test('fehlerhafte Plaene werden mit deutscher Meldung abgewiesen', async () => {
  const response = await call('POST', '/api/plans', {
    shopId: 'gibt-es-nicht',
    name: '',
    intervalUnit: 'week',
    intervalValue: 1,
    timeOfDay: '25:00',
    maxTotalCents: 10,
    items: [],
  });
  assert.equal(response.status, 400);
  assert.equal(response.json.code, 'validation');
  assert.ok(response.json.details.length >= 3);
});

test('Abmelden beendet die Sitzung', async () => {
  const logout = await call('POST', '/api/auth/logout');
  assert.equal(logout.status, 204);
  cookie = '';
  const shops = await call('GET', '/api/shops');
  assert.equal(shops.status, 401);
});
