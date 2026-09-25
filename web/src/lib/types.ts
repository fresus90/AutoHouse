export type ProviderSlug = 'dm' | 'rewe' | 'knuspr' | 'demo';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface Shop {
  id: string;
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
}

export interface PlanItem {
  id?: string;
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

export interface Plan {
  id: string;
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
  budgetStrategy: 'drop_optional' | 'reduce_qty' | 'abort';
  deliveryPreference: 'earliest' | 'cheapest' | 'fixed';
  deliveryWeekday: number | null;
  deliveryFrom: string | null;
  deliveryTo: string | null;
  dryRun: boolean;
  confirmOrder: boolean;
  notes: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  items: Required<PlanItem>[];
  scheduleLabel?: string;
  busy?: boolean;
}

export type RunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'needs_action';

export interface RunItem {
  id: string;
  label: string;
  requestedQty: number;
  orderedQty: number;
  unitPriceCents: number | null;
  totalCents: number | null;
  status: 'ordered' | 'unavailable' | 'too_expensive' | 'budget_skip' | 'error';
  message: string | null;
}

export interface RunLogEntry {
  id: number;
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface RunArtifact {
  id: string;
  kind: 'screenshot' | 'html' | 'trace';
  label: string | null;
}

export interface Run {
  id: string;
  planId: string;
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
  items?: RunItem[];
  logs?: RunLogEntry[];
  artifacts?: RunArtifact[];
}

export interface Meta {
  providers: Array<{
    provider: ProviderSlug;
    label: string;
    supportsDeliverySlots: boolean;
    requiresBrowser: boolean;
  }>;
  allowRealOrders: boolean;
  timezone: string;
  schedulerEnabled: boolean;
  encryptionConfigured: boolean;
  queue: { pending: number; active: number };
}

export interface PreviewLine {
  label: string;
  quantity: number;
  requestedQuantity: number;
  unitPriceCents: number | null;
  totalCents: number;
  status: 'ordered' | 'unavailable' | 'too_expensive' | 'budget_skip';
  message: string | null;
  priceKnown: boolean;
}

export interface Preview {
  totalCents: number;
  maxTotalCents: number;
  minTotalCents: number;
  requiredDropped: boolean;
  aborted: boolean;
  abortReason: string | null;
  lines: PreviewLine[];
}

export interface Dashboard {
  stats: {
    shops: number;
    plans: number;
    activePlans: number;
    total: number;
    success: number;
    failed: number;
    last30DaysCents: number;
  };
  upcoming: Array<{
    id: string;
    name: string;
    shopId: string;
    nextRunAt: string | null;
    maxTotalCents: number;
    dryRun: boolean;
    itemCount: number;
    scheduleLabel: string;
  }>;
  recentRuns: Run[];
  queue: { pending: number; active: number };
}
