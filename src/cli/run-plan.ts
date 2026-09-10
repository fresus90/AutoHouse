/**
 * Fuehrt einen Bestellplan sofort aus – nuetzlich zum Testen und fuer
 * externe Scheduler (cron, systemd timer).
 *
 *   npm run plan:run -- --plan <plan-id>
 *   npm run plan:run -- --list
 */
import { db } from '../db/index.js';
import { listUsers } from '../db/repo/users.js';
import { getPlanById, listPlans } from '../db/repo/plans.js';
import { getRun } from '../db/repo/runs.js';
import { enqueueRun, waitForIdle } from '../scheduler/queue.js';
import { closeBrowser } from '../automation/browser.js';
import { formatCents } from '../automation/util.js';
import { parseArgs } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  db();

  const planId = args.get('plan');
  if (args.flag('list') || !planId) {
    console.log('Bestellplaene:');
    for (const user of listUsers()) {
      for (const plan of listPlans(user.id)) {
        console.log(
          `  ${plan.id}  ${plan.name} (${plan.items?.length ?? 0} Artikel, ` +
            `Budget ${formatCents(plan.maxTotalCents)}, ${plan.enabled ? 'aktiv' : 'pausiert'})`,
        );
      }
    }
    if (!planId) {
      console.log('\nAufruf: npm run plan:run -- --plan <plan-id>');
      return;
    }
  }

  const plan = getPlanById(planId!);
  if (!plan) {
    console.error(`Bestellplan ${planId} nicht gefunden.`);
    process.exit(1);
  }

  const run = enqueueRun({ planId: plan.id, userId: plan.userId, trigger: 'manual' });
  if (!run) {
    console.error('Lauf konnte nicht eingeplant werden (laeuft moeglicherweise bereits).');
    process.exit(1);
  }
  console.log(`Lauf ${run.id} gestartet …`);
  await waitForIdle();

  const finished = getRun(plan.userId, run.id);
  console.log(`\nStatus: ${finished?.status}`);
  console.log(`Warenkorb: ${formatCents(finished?.cartTotalCents ?? null)}`);
  if (finished?.errorMessage) console.log(`Hinweis: ${finished.errorMessage}`);
  for (const item of finished?.items ?? []) {
    console.log(
      `  [${item.status.padEnd(13)}] ${item.orderedQty}/${item.requestedQty} x ${item.label} ` +
        `${formatCents(item.unitPriceCents)}`,
    );
  }
  await closeBrowser();
}

void main();
