import { Router } from 'express';
import { config } from '../../config.js';
import { listProviders } from '../../automation/registry.js';
import { isEncryptionConfigured } from '../../core/crypto.js';
import { queueStatus } from '../../scheduler/queue.js';
import { listPlans } from '../../db/repo/plans.js';
import { listShops } from '../../db/repo/shops.js';
import { listRuns, runStats } from '../../db/repo/runs.js';
import { describeSchedule } from '../../core/schedule.js';
import { currentUser, requireAuth } from '../auth.js';

export const metaRouter = Router();

metaRouter.get('/', (_req, res) => {
  res.json({
    providers: listProviders(),
    allowRealOrders: config.allowRealOrders,
    timezone: config.timezone,
    schedulerEnabled: config.scheduler.enabled,
    encryptionConfigured: isEncryptionConfigured(),
    queue: queueStatus(),
  });
});

metaRouter.get('/dashboard', requireAuth, (req, res) => {
  const user = currentUser(req);
  const shops = listShops(user.id);
  const plans = listPlans(user.id);
  const upcoming = plans
    .filter((plan) => plan.enabled && plan.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? ''))
    .slice(0, 5)
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      shopId: plan.shopId,
      nextRunAt: plan.nextRunAt,
      maxTotalCents: plan.maxTotalCents,
      dryRun: plan.dryRun,
      itemCount: plan.items?.length ?? 0,
      scheduleLabel: describeSchedule({
        intervalUnit: plan.intervalUnit,
        intervalValue: plan.intervalValue,
        weekday: plan.weekday,
        dayOfMonth: plan.dayOfMonth,
        timeOfDay: plan.timeOfDay,
        startDate: plan.startDate,
      }),
    }));

  res.json({
    stats: {
      shops: shops.length,
      plans: plans.length,
      activePlans: plans.filter((plan) => plan.enabled).length,
      ...runStats(user.id),
    },
    upcoming,
    recentRuns: listRuns(user.id, { limit: 8 }),
    queue: queueStatus(),
  });
});
