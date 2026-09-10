export type ProviderSlug = 'dm' | 'rewe' | 'demo';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface Shop {
  id: string;
  userId: string;
  provider: ProviderSlug;
  name: string;
  enabled: boolean;
  postalCode: string | null;
  marketId: string | null;
  hasCredentials: boolean;
  hasSession: boolean;
  sessionValidUntil: string | null;
  connectionStatus: 'unknown' | 'ok' | 'error';
  connectionMessage: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopCredentials {
  username: string;
  password: string;
}

export interface Product {
  id: string;
  shopId: string;
  externalId: string;
  name: string;
  brand: string | null;
  grammage: string | null;
  priceCents: number | null;
  basePrice: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  lastSeenAt: string;
}

export type BudgetStrategy = 'drop_optional' | 'reduce_qty' | 'abort';
export type DeliveryPreference = 'earliest' | 'cheapest' | 'fixed';

export interface OrderPlanItem {
  id: string;
  planId: string;
  productId: string | null;
  externalId: string | null;
  searchTerm: string | null;
  label: string;
  quantity: number;
  maxUnitPriceCents: number | null;
  priority: number;
  optional: boolean;
  allowSubstitute: boolean;
  position: number;
}

export interface OrderPlan {
  id: string;
  userId: string;
  shopId: string;
  name: string;
  enabled: boolean;
  intervalUnit: 'day' | 'week' | 'month';
  intervalValue: number;
  weekday: number | null;
  dayOfMonth: number | null;
  timeOfDay: string;
  startDate: string | null;
  maxTotalCents: number;
  minTotalCents: number;
  budgetStrategy: BudgetStrategy;
  deliveryPreference: DeliveryPreference;
  deliveryWeekday: number | null;
  deliveryFrom: string | null;
  deliveryTo: string | null;
  dryRun: boolean;
  confirmOrder: boolean;
  notes: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  items?: OrderPlanItem[];
}

export type RunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'needs_action';

export type RunItemStatus =
  | 'ordered'
  | 'unavailable'
  | 'too_expensive'
  | 'budget_skip'
  | 'error';

export interface OrderRunItem {
  id: string;
  runId: string;
  planItemId: string | null;
  label: string;
  requestedQty: number;
  orderedQty: number;
  unitPriceCents: number | null;
  totalCents: number | null;
  status: RunItemStatus;
  message: string | null;
}

export interface OrderRun {
  id: string;
  planId: string;
  userId: string;
  status: RunStatus;
  trigger: 'schedule' | 'manual';
  dryRun: boolean;
  plannedTotalCents: number | null;
  cartTotalCents: number | null;
  orderReference: string | null;
  deliverySlot: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  items?: OrderRunItem[];
  logs?: RunLogEntry[];
  artifacts?: RunArtifact[];
}

export interface RunLogEntry {
  id: number;
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data: unknown;
}

export interface RunArtifact {
  id: string;
  runId: string;
  kind: 'screenshot' | 'html' | 'trace';
  path: string;
  label: string | null;
  createdAt: string;
}
