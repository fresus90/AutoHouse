/**
 * Demo-Modus des Frontends.
 *
 * Erfuellt denselben Vertrag wie der echte API-Client, haelt die Daten aber
 * im Speicher des Browsers. Damit laesst sich die Oberflaeche ohne Server
 * ansehen und bedienen – auf dem Telefon, zum Ausprobieren, zum Zeigen.
 * Es werden keine Netzwerkanfragen gestellt und nichts bestellt.
 *
 * Gebaut wird dieser Modus mit VITE_DEMO=1 (siehe scripts/build-demo.mjs).
 */
import { ApiError, type ApiClient, type PlanPayload } from './http-api';
import type {
  Dashboard,
  Meta,
  Plan,
  PlanItem,
  Preview,
  PreviewLine,
  Product,
  ProviderSlug,
  Run,
  RunItem,
  RunLogEntry,
  Shop,
  User,
} from './types';

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const wait = <T>(value: T, ms = 180): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const id = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const iso = (date: Date): string => date.toISOString();

/** Naechster Termin an einem Wochentag zu einer Uhrzeit. */
function nextWeekday(weekday: number, hour: number, minute = 0): string {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setHours(hour, minute);
  const delta = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + (delta === 0 && date.getTime() <= Date.now() ? 7 : delta));
  return iso(date);
}

const minutesAgo = (minutes: number): string => iso(new Date(Date.now() - minutes * 60_000));
const daysAgo = (days: number): string => iso(new Date(Date.now() - days * 86_400_000));

// ---------------------------------------------------------------------------
// Beispieldaten
// ---------------------------------------------------------------------------

const demoUser: User = {
  id: 'usr_demo',
  email: 'du@beispiel.de',
  displayName: 'Demo-Konto',
  createdAt: daysAgo(120),
};

let currentUser: User | null = demoUser;

const shops: Shop[] = [
  {
    id: 'shop_rewe',
    provider: 'rewe',
    name: 'REWE Lieferservice zuhause',
    enabled: true,
    postalCode: '20095',
    marketId: null,
    hasCredentials: true,
    hasSession: true,
    sessionValidUntil: iso(new Date(Date.now() + 9 * 86_400_000)),
    connectionStatus: 'ok',
    connectionMessage: 'Session gueltig.',
    lastCheckedAt: minutesAgo(95),
  },
  {
    id: 'shop_dm',
    provider: 'dm',
    name: 'dm Onlineshop',
    enabled: true,
    postalCode: null,
    marketId: null,
    hasCredentials: true,
    hasSession: false,
    sessionValidUntil: null,
    connectionStatus: 'error',
    connectionMessage:
      'dm zeigt ein Captcha. Bitte einmalig ueber den Login-Assistenten anmelden.',
    lastCheckedAt: minutesAgo(300),
  },
  {
    id: 'shop_demo',
    provider: 'demo',
    name: 'Demo-Shop (zum Ausprobieren)',
    enabled: true,
    postalCode: null,
    marketId: null,
    hasCredentials: false,
    hasSession: false,
    sessionValidUntil: null,
    connectionStatus: 'ok',
    connectionMessage: 'Demo-Shop benoetigt keine Anmeldung.',
    lastCheckedAt: minutesAgo(20),
  },
];

interface CatalogueEntry {
  shopId: string;
  externalId: string;
  name: string;
  brand: string;
  grammage: string;
  priceCents: number;
}

const catalogue: CatalogueEntry[] = [
  { shopId: 'shop_rewe', externalId: '1010101', name: 'Frische Vollmilch 3,5 %', brand: 'REWE Beste Wahl', grammage: '1 l', priceCents: 119 },
  { shopId: 'shop_rewe', externalId: '1010102', name: 'Deutsche Markenbutter', brand: 'REWE Beste Wahl', grammage: '250 g', priceCents: 239 },
  { shopId: 'shop_rewe', externalId: '1010103', name: 'Roggenmischbrot geschnitten', brand: 'Harry', grammage: '750 g', priceCents: 199 },
  { shopId: 'shop_rewe', externalId: '1010104', name: 'Bio-Eier Freilandhaltung', brand: 'REWE Bio', grammage: '10 Stueck', priceCents: 389 },
  { shopId: 'shop_rewe', externalId: '1010105', name: 'Kaffee ganze Bohne Crema', brand: 'Dallmayr', grammage: '1 kg', priceCents: 1499 },
  { shopId: 'shop_rewe', externalId: '1010106', name: 'Spaghetti No. 5', brand: 'Barilla', grammage: '500 g', priceCents: 179 },
  { shopId: 'shop_rewe', externalId: '1010107', name: 'Passierte Tomaten', brand: 'Mutti', grammage: '500 g', priceCents: 129 },
  { shopId: 'shop_rewe', externalId: '1010108', name: 'Aepfel Elstar', brand: 'Regional', grammage: '1 kg', priceCents: 329 },
  { shopId: 'shop_rewe', externalId: '1010109', name: 'Naturjoghurt 3,5 %', brand: 'REWE Beste Wahl', grammage: '500 g', priceCents: 99 },
  { shopId: 'shop_rewe', externalId: '1010110', name: 'Bananen', brand: 'Chiquita', grammage: '1 kg', priceCents: 219 },
  { shopId: 'shop_dm', externalId: '4058172001234', name: 'Zahncreme Complete Care', brand: 'Dontodent', grammage: '75 ml', priceCents: 95 },
  { shopId: 'shop_dm', externalId: '4058172005678', name: 'Shampoo Sensitiv', brand: 'Balea', grammage: '300 ml', priceCents: 155 },
  { shopId: 'shop_dm', externalId: '4058172009012', name: 'Fluessigseife Nachfuellbeutel', brand: 'Balea', grammage: '500 ml', priceCents: 145 },
  { shopId: 'shop_dm', externalId: '4058172003456', name: 'Haferflocken zart', brand: 'dmBio', grammage: '500 g', priceCents: 129 },
  { shopId: 'shop_dm', externalId: '4058172007890', name: 'Toilettenpapier 4-lagig', brand: 'Sanft&Sicher', grammage: '8 Rollen', priceCents: 385 },
  { shopId: 'shop_demo', externalId: 'demo-milch', name: 'Frische Vollmilch 3,8 %', brand: 'Demo Hof', grammage: '1 l', priceCents: 119 },
  { shopId: 'shop_demo', externalId: 'demo-brot', name: 'Roggenmischbrot geschnitten', brand: 'Demo Baeckerei', grammage: '750 g', priceCents: 189 },
  { shopId: 'shop_demo', externalId: 'demo-kaffee', name: 'Kaffee ganze Bohne', brand: 'Demo Roesterei', grammage: '1 kg', priceCents: 1499 },
];

const products: Product[] = catalogue.map((entry) => ({
  id: `prd_${entry.externalId}`,
  shopId: entry.shopId,
  externalId: entry.externalId,
  name: entry.name,
  brand: entry.brand,
  grammage: entry.grammage,
  priceCents: entry.priceCents,
  basePrice: null,
  imageUrl: null,
  productUrl: null,
}));

const priceOf = (shopId: string, externalId: string | null | undefined): number | null =>
  catalogue.find((entry) => entry.shopId === shopId && entry.externalId === externalId)?.priceCents ??
  null;

function planItem(partial: Partial<PlanItem> & { label: string }): Required<PlanItem> {
  return {
    id: id('item'),
    productId: null,
    externalId: null,
    searchTerm: null,
    quantity: 1,
    maxUnitPriceCents: null,
    priority: 50,
    optional: false,
    allowSubstitute: false,
    ...partial,
  } as Required<PlanItem>;
}

const plans: Plan[] = [
  {
    id: 'plan_woche',
    shopId: 'shop_rewe',
    name: 'Wocheneinkauf',
    enabled: true,
    intervalUnit: 'week',
    intervalValue: 1,
    weekday: 2,
    dayOfMonth: null,
    timeOfDay: '08:00',
    startDate: null,
    maxTotalCents: 6000,
    minTotalCents: 3000,
    budgetStrategy: 'drop_optional',
    deliveryPreference: 'earliest',
    deliveryWeekday: 3,
    deliveryFrom: '17:00',
    deliveryTo: '20:00',
    dryRun: false,
    confirmOrder: true,
    notes: 'Standard-Grundausstattung fuer die Woche.',
    lastRunAt: daysAgo(6),
    nextRunAt: nextWeekday(2, 8),
    scheduleLabel: 'Jede Woche Dienstags um 08:00 Uhr',
    busy: false,
    items: [
      planItem({ label: 'Vollmilch 1 l', externalId: '1010101', quantity: 4, priority: 90 }),
      planItem({ label: 'Butter 250 g', externalId: '1010102', quantity: 2, priority: 80, maxUnitPriceCents: 279 }),
      planItem({ label: 'Roggenmischbrot', externalId: '1010103', quantity: 2, priority: 85 }),
      planItem({ label: 'Bio-Eier 10 Stueck', externalId: '1010104', quantity: 1, priority: 70 }),
      planItem({ label: 'Naturjoghurt', externalId: '1010109', quantity: 4, priority: 60, allowSubstitute: true }),
      planItem({ label: 'Aepfel Elstar', externalId: '1010108', quantity: 2, priority: 55 }),
      planItem({ label: 'Bananen', externalId: '1010110', quantity: 1, priority: 40, optional: true }),
      planItem({ label: 'Kaffee ganze Bohne', externalId: '1010105', quantity: 1, priority: 20, optional: true }),
    ],
  },
  {
    id: 'plan_vorrat',
    shopId: 'shop_rewe',
    name: 'Vorratskammer',
    enabled: true,
    intervalUnit: 'month',
    intervalValue: 1,
    weekday: null,
    dayOfMonth: 1,
    timeOfDay: '09:30',
    startDate: null,
    maxTotalCents: 4000,
    minTotalCents: 3000,
    budgetStrategy: 'reduce_qty',
    deliveryPreference: 'cheapest',
    deliveryWeekday: null,
    deliveryFrom: null,
    deliveryTo: null,
    dryRun: true,
    confirmOrder: false,
    notes: null,
    lastRunAt: daysAgo(11),
    nextRunAt: iso(new Date(Date.now() + 19 * 86_400_000)),
    scheduleLabel: 'Jeden Monat am 1. um 09:30 Uhr',
    busy: false,
    items: [
      planItem({ label: 'Spaghetti', externalId: '1010106', quantity: 6, priority: 70 }),
      planItem({ label: 'Passierte Tomaten', externalId: '1010107', quantity: 8, priority: 65 }),
      planItem({ label: 'Kaffee ganze Bohne', externalId: '1010105', quantity: 1, priority: 30 }),
    ],
  },
  {
    id: 'plan_drogerie',
    shopId: 'shop_dm',
    name: 'Drogerie-Nachschub',
    enabled: false,
    intervalUnit: 'week',
    intervalValue: 6,
    weekday: 5,
    dayOfMonth: null,
    timeOfDay: '19:00',
    startDate: null,
    maxTotalCents: 2500,
    minTotalCents: 0,
    budgetStrategy: 'drop_optional',
    deliveryPreference: 'earliest',
    deliveryWeekday: null,
    deliveryFrom: null,
    deliveryTo: null,
    dryRun: true,
    confirmOrder: false,
    notes: 'Erst aktivieren, wenn der dm-Login wieder steht.',
    lastRunAt: null,
    nextRunAt: null,
    scheduleLabel: 'Alle 6 Wochen Freitags um 19:00 Uhr',
    busy: false,
    items: [
      planItem({ label: 'Zahncreme', externalId: '4058172001234', quantity: 4, priority: 80 }),
      planItem({ label: 'Shampoo Sensitiv', externalId: '4058172005678', quantity: 2, priority: 60 }),
      planItem({ label: 'Toilettenpapier', externalId: '4058172007890', quantity: 2, priority: 90 }),
    ],
  },
];

// Ein Platzhalterbild fuer die Screenshot-Ansicht eines Laufs.
const PLACEHOLDER_SHOT =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300">
       <rect width="480" height="300" fill="#e9edf1"/>
       <rect x="0" y="0" width="480" height="46" fill="#c9d3dc"/>
       <rect x="20" y="70" width="200" height="16" rx="8" fill="#b7c2cc"/>
       <rect x="20" y="100" width="330" height="12" rx="6" fill="#c9d3dc"/>
       <rect x="20" y="122" width="290" height="12" rx="6" fill="#c9d3dc"/>
       <rect x="20" y="180" width="150" height="34" rx="8" fill="#1f6f43"/>
       <text x="240" y="270" font-family="system-ui" font-size="15" fill="#6b7783"
             text-anchor="middle">Screenshot (Demo-Modus)</text>
     </svg>`,
  );

function runItem(
  label: string,
  requested: number,
  ordered: number,
  unit: number | null,
  status: RunItem['status'],
  message: string | null = null,
): RunItem {
  return {
    id: id('ritem'),
    label,
    requestedQty: requested,
    orderedQty: ordered,
    unitPriceCents: unit,
    totalCents: unit === null ? null : unit * ordered,
    status,
    message,
  };
}

function logLines(entries: Array<[RunLogEntry['level'], string]>, startedAt: string): RunLogEntry[] {
  const base = new Date(startedAt).getTime();
  return entries.map(([level, message], index) => ({
    id: index + 1,
    ts: iso(new Date(base + index * 2400)),
    level,
    message,
  }));
}

const runs: Run[] = [
  (() => {
    const startedAt = daysAgo(6);
    return {
      id: 'run_1',
      planId: 'plan_woche',
      status: 'success',
      trigger: 'schedule',
      dryRun: false,
      plannedTotalCents: 4327,
      cartTotalCents: 4327,
      orderReference: 'RW-2026-884213',
      deliverySlot: 'Mittwoch 17:00 – 19:00',
      errorCode: null,
      errorMessage: null,
      startedAt,
      finishedAt: iso(new Date(new Date(startedAt).getTime() + 78_000)),
      items: [
        runItem('Frische Vollmilch 3,5 %', 4, 4, 119, 'ordered'),
        runItem('Deutsche Markenbutter', 2, 2, 239, 'ordered'),
        runItem('Roggenmischbrot geschnitten', 2, 2, 199, 'ordered'),
        runItem('Bio-Eier Freilandhaltung', 1, 1, 389, 'ordered'),
        runItem('Naturjoghurt 3,5 %', 4, 4, 99, 'ordered'),
        runItem('Aepfel Elstar', 2, 2, 329, 'ordered'),
        runItem('Bananen', 1, 1, 219, 'ordered'),
        runItem('Kaffee ganze Bohne Crema', 1, 0, 1499, 'budget_skip', 'Passt nicht mehr ins Budget.'),
      ],
      logs: logLines(
        [
          ['info', 'Starte Bestellplan "Wocheneinkauf" bei REWE Lieferservice zuhause (ECHTE Bestellung).'],
          ['info', 'Bestehende Session ist gueltig – kein Login noetig.'],
          ['info', 'Geplante Summe: 43,27 € von maximal 60,00 €.'],
          ['warn', 'Kaffee ganze Bohne: passt nicht mehr ins Budget, wird weggelassen.'],
          ['info', 'Leere den Warenkorb, um Reste aus frueheren Laeufen auszuschliessen.'],
          ['info', 'In den Warenkorb: 4 x Vollmilch 1 l (1,19 € / Stueck)'],
          ['info', 'In den Warenkorb: 2 x Butter 250 g (2,39 € / Stueck)'],
          ['info', 'Warenkorb-Summe laut Shop: 43,27 €'],
          ['info', 'Lieferzeitfenster reserviert: Mittwoch 17:00 – 19:00'],
          ['warn', 'Loese die kostenpflichtige Bestellung aus.'],
          ['info', 'Bestellung abgeschickt. Referenz: RW-2026-884213'],
        ],
        startedAt,
      ),
      artifacts: [{ id: 'art_1', kind: 'screenshot', label: 'Bestellbestaetigung' }],
    } satisfies Run;
  })(),
  (() => {
    const startedAt = daysAgo(11);
    return {
      id: 'run_2',
      planId: 'plan_vorrat',
      status: 'needs_action',
      trigger: 'schedule',
      dryRun: true,
      plannedTotalCents: 2340,
      cartTotalCents: 2340,
      orderReference: null,
      deliverySlot: null,
      errorCode: 'minimum_order',
      errorMessage:
        'Mindestbestellwert von 30,00 € nicht erreicht (23,40 €). Es wurde nichts bestellt.',
      startedAt,
      finishedAt: iso(new Date(new Date(startedAt).getTime() + 51_000)),
      items: [
        runItem('Spaghetti No. 5', 6, 6, 179, 'ordered'),
        runItem('Passierte Tomaten', 8, 8, 129, 'ordered'),
        runItem('Kaffee ganze Bohne Crema', 1, 0, 1499, 'budget_skip', 'Passt nicht mehr ins Budget.'),
      ],
      logs: logLines(
        [
          ['info', 'Starte Bestellplan "Vorratskammer" (Testlauf – es wird nichts bestellt).'],
          ['info', 'Geplante Summe: 23,40 € von maximal 40,00 €.'],
          ['info', 'Warenkorb-Summe laut Shop: 23,40 €'],
          ['warn', 'Mindestbestellwert von 30,00 € nicht erreicht (23,40 €). Es wurde nichts bestellt.'],
        ],
        startedAt,
      ),
      artifacts: [],
    } satisfies Run;
  })(),
  (() => {
    const startedAt = daysAgo(13);
    return {
      id: 'run_3',
      planId: 'plan_woche',
      status: 'partial',
      trigger: 'schedule',
      dryRun: false,
      plannedTotalCents: 4108,
      cartTotalCents: 3719,
      orderReference: 'RW-2026-871004',
      deliverySlot: 'Donnerstag 18:00 – 20:00',
      errorCode: null,
      errorMessage: 'Ein Pflichtartikel war nicht lieferbar.',
      startedAt,
      finishedAt: iso(new Date(new Date(startedAt).getTime() + 94_000)),
      items: [
        runItem('Frische Vollmilch 3,5 %', 4, 4, 119, 'ordered'),
        runItem('Deutsche Markenbutter', 2, 0, 299, 'too_expensive', 'Stueckpreis 2,99 € liegt ueber dem Limit von 2,79 €.'),
        runItem('Roggenmischbrot geschnitten', 2, 2, 199, 'ordered'),
        runItem('Bio-Eier Freilandhaltung', 1, 0, null, 'unavailable', 'Artikel im Shop nicht gefunden oder nicht lieferbar.'),
        runItem('Naturjoghurt 3,5 %', 4, 4, 99, 'ordered'),
        runItem('Aepfel Elstar', 2, 2, 329, 'ordered'),
      ],
      logs: logLines(
        [
          ['info', 'Starte Bestellplan "Wocheneinkauf" (ECHTE Bestellung).'],
          ['warn', 'Butter: Stueckpreis 2,99 € liegt ueber dem Limit von 2,79 €.'],
          ['warn', 'Kein Treffer fuer "Bio-Eier 10 Stueck".'],
          ['info', 'Warenkorb-Summe laut Shop: 37,19 €'],
          ['info', 'Bestellung abgeschickt. Referenz: RW-2026-871004'],
        ],
        startedAt,
      ),
      artifacts: [{ id: 'art_3', kind: 'screenshot', label: 'Warenkorb' }],
    } satisfies Run;
  })(),
  (() => {
    const startedAt = daysAgo(20);
    return {
      id: 'run_4',
      planId: 'plan_drogerie',
      status: 'failed',
      trigger: 'manual',
      dryRun: true,
      plannedTotalCents: null,
      cartTotalCents: null,
      orderReference: null,
      deliverySlot: null,
      errorCode: 'login',
      errorMessage:
        'dm zeigt ein Captcha. Bitte einmalig ueber "npm run shop:login" im sichtbaren Browser anmelden.',
      startedAt,
      finishedAt: iso(new Date(new Date(startedAt).getTime() + 33_000)),
      items: [],
      logs: logLines(
        [
          ['info', 'Starte Bestellplan "Drogerie-Nachschub" (Testlauf).'],
          ['info', 'Melde bei dm an.'],
          ['error', 'dm zeigt ein Captcha. Anmeldung abgebrochen.'],
        ],
        startedAt,
      ),
      artifacts: [{ id: 'art_4', kind: 'screenshot', label: 'dm-captcha' }],
    } satisfies Run;
  })(),
];

// ---------------------------------------------------------------------------
// Vorschau- und Laufberechnung (vereinfacht, aber mit denselben Regeln)
// ---------------------------------------------------------------------------

function buildPreview(plan: Plan): Preview {
  const sorted = [...plan.items].sort((a, b) => {
    if (a.optional !== b.optional) return a.optional ? 1 : -1;
    return b.priority - a.priority;
  });

  let total = 0;
  let requiredDropped = false;
  const byItem = new Map<string, PreviewLine>();

  for (const item of sorted) {
    const price = priceOf(plan.shopId, item.externalId);
    const label =
      catalogue.find((entry) => entry.shopId === plan.shopId && entry.externalId === item.externalId)
        ?.name ?? item.label;

    if (price === null) {
      byItem.set(item.id, {
        label,
        quantity: 0,
        requestedQuantity: item.quantity,
        unitPriceCents: null,
        totalCents: 0,
        status: 'unavailable',
        message: 'Noch kein Preis bekannt – bitte einmal im Shop suchen.',
        priceKnown: false,
      });
      if (!item.optional) requiredDropped = true;
      continue;
    }
    if (item.maxUnitPriceCents !== null && price > item.maxUnitPriceCents) {
      byItem.set(item.id, {
        label,
        quantity: 0,
        requestedQuantity: item.quantity,
        unitPriceCents: price,
        totalCents: 0,
        status: 'too_expensive',
        message: `Stueckpreis liegt ueber dem Limit von ${(item.maxUnitPriceCents / 100).toFixed(2)} €.`,
        priceKnown: true,
      });
      continue;
    }

    const cost = price * item.quantity;
    if (total + cost <= plan.maxTotalCents) {
      total += cost;
      byItem.set(item.id, {
        label,
        quantity: item.quantity,
        requestedQuantity: item.quantity,
        unitPriceCents: price,
        totalCents: cost,
        status: 'ordered',
        message: null,
        priceKnown: true,
      });
      continue;
    }

    if (plan.budgetStrategy === 'reduce_qty') {
      const affordable = Math.floor((plan.maxTotalCents - total) / price);
      if (affordable >= 1) {
        total += affordable * price;
        byItem.set(item.id, {
          label,
          quantity: affordable,
          requestedQuantity: item.quantity,
          unitPriceCents: price,
          totalCents: affordable * price,
          status: 'ordered',
          message: `Menge wegen Budget von ${item.quantity} auf ${affordable} reduziert.`,
          priceKnown: true,
        });
        continue;
      }
    }

    byItem.set(item.id, {
      label,
      quantity: 0,
      requestedQuantity: item.quantity,
      unitPriceCents: price,
      totalCents: 0,
      status: 'budget_skip',
      message: 'Passt nicht mehr ins Budget.',
      priceKnown: true,
    });
    if (!item.optional) requiredDropped = true;
  }

  return {
    totalCents: total,
    maxTotalCents: plan.maxTotalCents,
    minTotalCents: plan.minTotalCents,
    requiredDropped,
    aborted: false,
    abortReason: null,
    // Reihenfolge wie im Plan, nicht wie in der Budgetrechnung.
    lines: plan.items.map((item) => byItem.get(item.id)!).filter(Boolean),
  };
}

/** Startet einen Lauf, der ueber ein paar Sekunden hinweg "arbeitet". */
function simulateRun(plan: Plan): Run {
  const preview = buildPreview(plan);
  const startedAt = iso(new Date());
  const run: Run = {
    id: id('run'),
    planId: plan.id,
    status: 'running',
    trigger: 'manual',
    dryRun: plan.dryRun || !plan.confirmOrder,
    plannedTotalCents: preview.totalCents,
    cartTotalCents: null,
    orderReference: null,
    deliverySlot: null,
    errorCode: null,
    errorMessage: null,
    startedAt,
    finishedAt: null,
    items: [],
    logs: [],
    artifacts: [],
  };
  runs.unshift(run);
  plan.busy = true;

  const script: Array<[number, RunLogEntry['level'], string, (() => void)?]> = [
    [0, 'info', `Starte Bestellplan "${plan.name}" (${run.dryRun ? 'Testlauf – es wird nichts bestellt' : 'ECHTE Bestellung'}).`],
    [1200, 'info', 'Bestehende Session ist gueltig – kein Login noetig.'],
    [2600, 'info', `Geplante Summe: ${(preview.totalCents / 100).toFixed(2)} € von maximal ${(plan.maxTotalCents / 100).toFixed(2)} €.`],
    [3800, 'info', 'Leere den Warenkorb, um Reste aus frueheren Laeufen auszuschliessen.'],
    [5000, 'info', 'Lege die Artikel in den Warenkorb …'],
    [
      7000,
      'info',
      `Warenkorb-Summe laut Shop: ${(preview.totalCents / 100).toFixed(2)} €`,
      () => {
        run.cartTotalCents = preview.totalCents;
      },
    ],
    [
      8400,
      'info',
      run.dryRun
        ? 'Testlauf beendet: Warenkorb steht bereit, es wurde nichts bestellt.'
        : 'Bestellung abgeschickt.',
      () => {
        run.items = preview.lines.map((line) =>
          runItem(
            line.label,
            line.requestedQuantity,
            line.status === 'ordered' ? line.quantity : 0,
            line.unitPriceCents,
            line.status === 'ordered' ? 'ordered' : line.status,
            line.message,
          ),
        );
        run.status = preview.requiredDropped ? 'partial' : 'success';
        run.finishedAt = iso(new Date());
        if (!run.dryRun) run.orderReference = `DEMO-${Date.now().toString(36).toUpperCase()}`;
        run.deliverySlot = 'Morgen 17:00 – 19:00';
        plan.busy = false;
        plan.lastRunAt = run.finishedAt;
      },
    ],
  ];

  let logId = 0;
  for (const [delay, level, message, effect] of script) {
    setTimeout(() => {
      logId += 1;
      run.logs = [...(run.logs ?? []), { id: logId, ts: iso(new Date()), level, message }];
      effect?.();
    }, delay);
  }

  return run;
}

// ---------------------------------------------------------------------------
// Der Client
// ---------------------------------------------------------------------------

const meta: Meta = {
  providers: [
    { provider: 'rewe', label: 'REWE Lieferservice', supportsDeliverySlots: true, requiresBrowser: true },
    { provider: 'dm', label: 'dm Onlineshop', supportsDeliverySlots: false, requiresBrowser: true },
    { provider: 'demo', label: 'Demo-Shop (ohne echte Bestellung)', supportsDeliverySlots: true, requiresBrowser: false },
  ],
  allowRealOrders: false,
  timezone: 'Europe/Berlin',
  schedulerEnabled: true,
  encryptionConfigured: true,
  queue: { pending: 0, active: 0 },
};

const findPlan = (planId: string): Plan => {
  const plan = plans.find((entry) => entry.id === planId);
  if (!plan) throw new ApiError(404, 'Bestellplan nicht gefunden.');
  return plan;
};

const findShop = (shopId: string): Shop => {
  const shop = shops.find((entry) => entry.id === shopId);
  if (!shop) throw new ApiError(404, 'Shop nicht gefunden.');
  return shop;
};

function applyPlanPayload(plan: Plan, payload: PlanPayload): Plan {
  Object.assign(plan, {
    shopId: payload.shopId,
    name: payload.name,
    enabled: payload.enabled ?? true,
    intervalUnit: payload.intervalUnit,
    intervalValue: payload.intervalValue,
    weekday: payload.weekday ?? null,
    dayOfMonth: payload.dayOfMonth ?? null,
    timeOfDay: payload.timeOfDay,
    startDate: payload.startDate ?? null,
    maxTotalCents: payload.maxTotalCents,
    minTotalCents: payload.minTotalCents ?? 0,
    budgetStrategy: payload.budgetStrategy ?? 'drop_optional',
    deliveryPreference: payload.deliveryPreference ?? 'earliest',
    deliveryWeekday: payload.deliveryWeekday ?? null,
    deliveryFrom: payload.deliveryFrom ?? null,
    deliveryTo: payload.deliveryTo ?? null,
    dryRun: payload.dryRun ?? true,
    confirmOrder: payload.confirmOrder ?? false,
    notes: payload.notes ?? null,
    items: payload.items.map((item) => planItem({ ...item, label: item.label })),
  });

  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const step = plan.intervalValue;
  plan.scheduleLabel =
    plan.intervalUnit === 'week'
      ? `${step === 1 ? 'Jede Woche' : `Alle ${step} Wochen`}${
          plan.weekday === null ? '' : ` ${weekdays[plan.weekday]}s`
        } um ${plan.timeOfDay} Uhr`
      : plan.intervalUnit === 'month'
        ? `${step === 1 ? 'Jeden Monat' : `Alle ${step} Monate`} am ${plan.dayOfMonth ?? 1}. um ${plan.timeOfDay} Uhr`
        : `${step === 1 ? 'Taeglich' : `Alle ${step} Tage`} um ${plan.timeOfDay} Uhr`;

  const [hour, minute] = plan.timeOfDay.split(':').map(Number);
  plan.nextRunAt = plan.enabled
    ? plan.intervalUnit === 'week' && plan.weekday !== null
      ? nextWeekday(plan.weekday, hour ?? 8, minute ?? 0)
      : iso(new Date(Date.now() + 86_400_000))
    : null;
  return plan;
}

export const client: ApiClient = {
  authState: () => wait({ needsSetup: false }),
  me: () => wait({ user: currentUser }),
  login: (email: string) => {
    currentUser = { ...demoUser, email: email || demoUser.email };
    return wait({ user: currentUser });
  },
  register: (email: string, _password: string, displayName?: string) => {
    currentUser = { ...demoUser, email, displayName: displayName ?? null };
    return wait({ user: currentUser });
  },
  logout: () => {
    currentUser = null;
    return wait(undefined as void);
  },
  changePassword: () => wait(undefined as void, 400),

  meta: () => wait(meta),
  dashboard: () => {
    const dashboard: Dashboard = {
      stats: {
        shops: shops.length,
        plans: plans.length,
        activePlans: plans.filter((plan) => plan.enabled).length,
        total: runs.length,
        success: runs.filter((run) => run.status === 'success' || run.status === 'partial').length,
        failed: runs.filter((run) => run.status === 'failed').length,
        last30DaysCents: runs
          .filter((run) => !run.dryRun && run.cartTotalCents)
          .reduce((sum, run) => sum + (run.cartTotalCents ?? 0), 0),
      },
      upcoming: plans
        .filter((plan) => plan.enabled && plan.nextRunAt)
        .sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? ''))
        .map((plan) => ({
          id: plan.id,
          name: plan.name,
          shopId: plan.shopId,
          nextRunAt: plan.nextRunAt,
          maxTotalCents: plan.maxTotalCents,
          dryRun: plan.dryRun,
          itemCount: plan.items.length,
          scheduleLabel: plan.scheduleLabel ?? '',
        })),
      recentRuns: runs.slice(0, 8),
      queue: { pending: 0, active: runs.filter((run) => run.status === 'running').length },
    };
    return wait(dashboard);
  },

  shops: () => wait({ shops: [...shops] }),
  createShop: (payload: Record<string, unknown>) => {
    const shop: Shop = {
      id: id('shop'),
      provider: (payload.provider as ProviderSlug) ?? 'demo',
      name: String(payload.name ?? 'Neuer Shop'),
      enabled: true,
      postalCode: (payload.postalCode as string | null) ?? null,
      marketId: (payload.marketId as string | null) ?? null,
      hasCredentials: Boolean(payload.credentials),
      hasSession: false,
      sessionValidUntil: null,
      connectionStatus: 'unknown',
      connectionMessage: null,
      lastCheckedAt: null,
    };
    shops.push(shop);
    return wait({ shop });
  },
  updateShop: (shopId: string, payload: Record<string, unknown>) => {
    const shop = findShop(shopId);
    if (payload.name !== undefined) shop.name = String(payload.name);
    if (payload.postalCode !== undefined) shop.postalCode = (payload.postalCode as string) ?? null;
    if (payload.marketId !== undefined) shop.marketId = (payload.marketId as string) ?? null;
    if (payload.credentials) shop.hasCredentials = true;
    return wait({ shop });
  },
  deleteShop: (shopId: string) => {
    const index = shops.findIndex((shop) => shop.id === shopId);
    if (index >= 0) shops.splice(index, 1);
    return wait(undefined as void);
  },
  testShop: (shopId: string) => {
    const shop = findShop(shopId);
    const ok = shop.provider !== 'dm';
    shop.connectionStatus = ok ? 'ok' : 'error';
    shop.connectionMessage = ok
      ? 'Bestehende Session ist gueltig.'
      : 'dm zeigt ein Captcha. Bitte einmalig ueber den Login-Assistenten anmelden.';
    shop.hasSession = ok;
    shop.lastCheckedAt = iso(new Date());
    return wait(
      { result: { ok, message: shop.connectionMessage ?? undefined }, shop },
      // Ein echter Verbindungstest startet einen Browser – das dauert.
      1600,
    );
  },
  clearShopSession: (shopId: string) => {
    const shop = findShop(shopId);
    shop.hasSession = false;
    shop.sessionValidUntil = null;
    shop.connectionStatus = 'unknown';
    shop.connectionMessage = 'Session verworfen.';
    return wait(undefined as void);
  },
  cachedProducts: (shopId: string, search?: string) => {
    const needle = (search ?? '').trim().toLowerCase();
    return wait({
      products: products.filter(
        (product) =>
          product.shopId === shopId &&
          (!needle ||
            product.name.toLowerCase().includes(needle) ||
            (product.brand ?? '').toLowerCase().includes(needle)),
      ),
    });
  },
  searchProducts: (shopId: string, query: string) => {
    const needle = query.trim().toLowerCase();
    return wait(
      {
        products: products.filter(
          (product) =>
            product.shopId === shopId &&
            (product.name.toLowerCase().includes(needle) ||
              (product.brand ?? '').toLowerCase().includes(needle) ||
              product.externalId.includes(needle)),
        ),
      },
      900,
    );
  },

  plans: () => wait({ plans: [...plans] }),
  plan: (planId: string) => wait({ plan: findPlan(planId) }),
  createPlan: (payload: PlanPayload) => {
    const plan = applyPlanPayload(
      { id: id('plan'), items: [], busy: false, lastRunAt: null } as unknown as Plan,
      payload,
    );
    plans.push(plan);
    return wait({ plan });
  },
  updatePlan: (planId: string, payload: PlanPayload) =>
    wait({ plan: applyPlanPayload(findPlan(planId), payload) }),
  deletePlan: (planId: string) => {
    const index = plans.findIndex((plan) => plan.id === planId);
    if (index >= 0) plans.splice(index, 1);
    return wait(undefined as void);
  },
  setPlanEnabled: (planId: string, enabled: boolean) => {
    const plan = findPlan(planId);
    plan.enabled = enabled;
    if (!enabled) plan.nextRunAt = null;
    else if (!plan.nextRunAt) {
      const [hour, minute] = plan.timeOfDay.split(':').map(Number);
      plan.nextRunAt =
        plan.weekday !== null
          ? nextWeekday(plan.weekday, hour ?? 8, minute ?? 0)
          : iso(new Date(Date.now() + 86_400_000));
    }
    return wait({ plan });
  },
  runPlan: (planId: string) => wait({ run: simulateRun(findPlan(planId)) }, 300),
  preview: (planId: string) => {
    const plan = findPlan(planId);
    return wait({ preview: buildPreview(plan), nextRunAt: plan.nextRunAt });
  },

  runs: (planId?: string) =>
    wait({ runs: planId ? runs.filter((run) => run.planId === planId) : [...runs] }),
  run: (runId: string) => {
    const run = runs.find((entry) => entry.id === runId);
    if (!run) throw new ApiError(404, 'Lauf nicht gefunden.');
    return wait({ run });
  },
  runLogs: (runId: string, after: number) => {
    const run = runs.find((entry) => entry.id === runId);
    if (!run) throw new ApiError(404, 'Lauf nicht gefunden.');
    return wait(
      {
        logs: (run.logs ?? []).filter((entry) => entry.id > after),
        status: run.status,
        finishedAt: run.finishedAt,
      },
      120,
    );
  },
  artifactUrl: () => PLACEHOLDER_SHOT,
};
