import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCents, formatDateTime } from '../lib/format';
import { Empty, ErrorNotice, Spinner, StatusBadge } from '../components/ui';
import type { Plan, Run } from '../lib/types';

export function RunsPage() {
  const [params, setParams] = useSearchParams();
  const planFilter = params.get('plan') ?? '';
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      Promise.all([api.runs(planFilter || undefined), api.plans()])
        .then(([runResponse, planResponse]) => {
          if (!active) return;
          setRuns(runResponse.runs);
          setPlans(planResponse.plans);
        })
        .catch((caught: unknown) => {
          if (active) setError(caught);
        });
    };
    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [planFilter]);

  const planName = (planId: string): string =>
    plans.find((plan) => plan.id === planId)?.name ?? 'Gelöschter Plan';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Läufe</h1>
          <p>Jede Ausführung mit Protokoll, Warenkorb und Ergebnis.</p>
        </div>
        <div className="field" style={{ marginBottom: 0, minWidth: '220px' }}>
          <label htmlFor="filter">Nach Plan filtern</label>
          <select
            id="filter"
            value={planFilter}
            onChange={(event) => {
              const value = event.target.value;
              setParams(value ? { plan: value } : {});
            }}
          >
            <option value="">Alle Pläne</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ErrorNotice error={error} />

      <div className="card">
        {!runs ? (
          <Spinner />
        ) : runs.length === 0 ? (
          <Empty>Noch keine Läufe.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Start</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Auslöser</th>
                  <th className="num">Geplant</th>
                  <th className="num">Warenkorb</th>
                  <th>Bestellung</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatDateTime(run.startedAt)}</td>
                    <td>{planName(run.planId)}</td>
                    <td>
                      <StatusBadge status={run.status} />{' '}
                      {run.dryRun && <span className="badge">Testlauf</span>}
                    </td>
                    <td className="muted">{run.trigger === 'manual' ? 'Manuell' : 'Zeitplan'}</td>
                    <td className="num">{formatCents(run.plannedTotalCents)}</td>
                    <td className="num">{formatCents(run.cartTotalCents)}</td>
                    <td className="mono">{run.orderReference ?? '–'}</td>
                    <td>
                      <Link to={`/laeufe/${run.id}`}>Details</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
