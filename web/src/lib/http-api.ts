/**
 * Der echte API-Client: spricht mit der AutoHouse-Instanz auf demselben Host.
 *
 * Welcher Client tatsaechlich gebuendelt wird, entscheidet der Alias "@client"
 * in web/vite.config.ts – im Demo-Build ist das web/src/lib/demo-api.ts, und
 * diese Datei landet dann gar nicht erst im Bundle (und umgekehrt).
 */
import type {
  Dashboard,
  Meta,
  Plan,
  PlanItem,
  Preview,
  Product,
  Run,
  RunLogEntry,
  Shop,
  User,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error ?? `Anfrage fehlgeschlagen (${response.status}).`,
      payload?.details,
    );
  }
  return payload as T;
}

export const client = {
  authState: () => request<{ needsSetup: boolean }>('GET', '/api/auth/state'),
  me: () => request<{ user: User | null }>('GET', '/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/login', { email, password }),
  register: (email: string, password: string, displayName?: string) =>
    request<{ user: User }>('POST', '/api/auth/register', { email, password, displayName }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/api/auth/password', { currentPassword, newPassword }),

  meta: () => request<Meta>('GET', '/api/meta'),
  dashboard: () => request<Dashboard>('GET', '/api/meta/dashboard'),

  shops: () => request<{ shops: Shop[] }>('GET', '/api/shops'),
  createShop: (payload: Record<string, unknown>) =>
    request<{ shop: Shop }>('POST', '/api/shops', payload),
  updateShop: (id: string, payload: Record<string, unknown>) =>
    request<{ shop: Shop }>('PATCH', `/api/shops/${id}`, payload),
  deleteShop: (id: string) => request<void>('DELETE', `/api/shops/${id}`),
  testShop: (id: string) =>
    request<{ result: { ok: boolean; message?: string }; shop: Shop }>('POST', `/api/shops/${id}/test`),
  clearShopSession: (id: string) => request<void>('DELETE', `/api/shops/${id}/session`),
  cachedProducts: (id: string, search?: string) =>
    request<{ products: Product[] }>(
      'GET',
      `/api/shops/${id}/products${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    ),
  searchProducts: (id: string, query: string) =>
    request<{ products: Product[] }>('POST', `/api/shops/${id}/search`, { query }),

  plans: () => request<{ plans: Plan[] }>('GET', '/api/plans'),
  plan: (id: string) => request<{ plan: Plan }>('GET', `/api/plans/${id}`),
  createPlan: (payload: PlanPayload) => request<{ plan: Plan }>('POST', '/api/plans', payload),
  updatePlan: (id: string, payload: PlanPayload) =>
    request<{ plan: Plan }>('PUT', `/api/plans/${id}`, payload),
  deletePlan: (id: string) => request<void>('DELETE', `/api/plans/${id}`),
  setPlanEnabled: (id: string, enabled: boolean) =>
    request<{ plan: Plan }>('POST', `/api/plans/${id}/enabled`, { enabled }),
  runPlan: (id: string) => request<{ run: Run }>('POST', `/api/plans/${id}/run`),
  preview: (id: string) =>
    request<{ preview: Preview; nextRunAt: string | null }>('GET', `/api/plans/${id}/preview`),

  runs: (planId?: string) =>
    request<{ runs: Run[] }>('GET', `/api/runs${planId ? `?planId=${planId}` : ''}`),
  run: (id: string) => request<{ run: Run }>('GET', `/api/runs/${id}`),
  runLogs: (id: string, after: number) =>
    request<{ logs: RunLogEntry[]; status: string; finishedAt: string | null }>(
      'GET',
      `/api/runs/${id}/logs?after=${after}`,
    ),
  artifactUrl: (runId: string, artifactId: string) => `/api/runs/${runId}/artifacts/${artifactId}`,
};

/** Der Vertrag, den jeder Client erfuellt – auch der Demo-Client. */
export type ApiClient = typeof client;

/** Nutzdaten beim Anlegen und Ändern eines Bestellplans. */
export interface PlanPayload {
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
  budgetStrategy?: 'drop_optional' | 'reduce_qty' | 'abort';
  deliveryPreference?: 'earliest' | 'cheapest' | 'fixed';
  deliveryWeekday?: number | null;
  deliveryFrom?: string | null;
  deliveryTo?: string | null;
  dryRun?: boolean;
  confirmOrder?: boolean;
  notes?: string | null;
  items: PlanItem[];
}
