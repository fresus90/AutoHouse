import { z } from 'zod';

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Erwartet wird eine Uhrzeit im Format HH:MM.');

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Erwartet wird ein Datum im Format JJJJ-MM-TT.');

export const providerSchema = z.enum(['dm', 'rewe', 'demo']);

export const loginSchema = z.object({
  email: z.string().email('Bitte eine gueltige E-Mail-Adresse angeben.'),
  password: z.string().min(1, 'Bitte das Passwort eingeben.'),
});

export const registerSchema = z.object({
  email: z.string().email('Bitte eine gueltige E-Mail-Adresse angeben.'),
  password: z.string().min(10, 'Das Passwort braucht mindestens 10 Zeichen.'),
  displayName: z.string().trim().min(1).max(80).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'Das neue Passwort braucht mindestens 10 Zeichen.'),
});

export const shopSchema = z.object({
  provider: providerSchema,
  name: z.string().trim().min(1, 'Bitte einen Namen vergeben.').max(80),
  enabled: z.boolean().optional(),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'Bitte eine fuenfstellige Postleitzahl angeben.')
    .nullish(),
  marketId: z.string().trim().max(64).nullish(),
  credentials: z
    .object({
      username: z.string().trim().min(1),
      password: z.string().min(1),
    })
    .nullish(),
});

export const shopUpdateSchema = shopSchema.partial().extend({
  provider: providerSchema.optional(),
});

export const planItemSchema = z.object({
  productId: z.string().nullish(),
  externalId: z.string().trim().max(64).nullish(),
  searchTerm: z.string().trim().max(120).nullish(),
  label: z.string().trim().min(1, 'Bitte eine Bezeichnung angeben.').max(120),
  quantity: z.number().int().min(1).max(99),
  maxUnitPriceCents: z.number().int().min(0).max(1_000_000).nullish(),
  priority: z.number().int().min(0).max(100).optional(),
  optional: z.boolean().optional(),
  allowSubstitute: z.boolean().optional(),
});

export const planSchema = z
  .object({
    shopId: z.string().min(1, 'Bitte einen Shop waehlen.'),
    name: z.string().trim().min(1, 'Bitte einen Namen vergeben.').max(80),
    enabled: z.boolean().optional(),
    intervalUnit: z.enum(['day', 'week', 'month']),
    intervalValue: z.number().int().min(1).max(52),
    weekday: z.number().int().min(0).max(6).nullish(),
    dayOfMonth: z.number().int().min(1).max(28).nullish(),
    timeOfDay,
    startDate: dateOnly.nullish(),
    maxTotalCents: z.number().int().min(100, 'Das Budget muss mindestens 1 € betragen.').max(100_000_00),
    minTotalCents: z.number().int().min(0).max(100_000_00).optional(),
    budgetStrategy: z.enum(['drop_optional', 'reduce_qty', 'abort']).optional(),
    deliveryPreference: z.enum(['earliest', 'cheapest', 'fixed']).optional(),
    deliveryWeekday: z.number().int().min(0).max(6).nullish(),
    deliveryFrom: timeOfDay.nullish(),
    deliveryTo: timeOfDay.nullish(),
    dryRun: z.boolean().optional(),
    confirmOrder: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullish(),
    items: z.array(planItemSchema).min(1, 'Ein Bestellplan braucht mindestens einen Artikel.'),
  })
  .refine((plan) => plan.minTotalCents === undefined || plan.minTotalCents <= plan.maxTotalCents, {
    message: 'Der Mindestbestellwert darf das Budget nicht uebersteigen.',
    path: ['minTotalCents'],
  })
  .refine((plan) => plan.intervalUnit !== 'week' || plan.weekday !== null, {
    message: 'Bitte einen Wochentag waehlen.',
    path: ['weekday'],
  });

export const searchSchema = z.object({
  query: z.string().trim().min(2, 'Bitte mindestens zwei Zeichen eingeben.').max(120),
  limit: z.number().int().min(1).max(50).optional(),
});

export type PlanPayload = z.infer<typeof planSchema>;
export type ShopPayload = z.infer<typeof shopSchema>;
