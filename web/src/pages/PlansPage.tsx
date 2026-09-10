import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCents, formatDateTime, formatRelative } from '../lib/format';
import { Empty, ErrorNotice, Notice, Spinner } from '../components/ui';
import type { Plan, Shop } from '../lib/types';

export function PlansPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      const [planResponse, shopResponse] = await Promise.all([api.plans(), api.shops()]);
      setPlans(planResponse.plans);
      setShops(shopResponse.shops);
    } catch (caught) {
      setError(caught);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const shopName = (shopId: string): string =>
    shops.find((shop) => shop.id === shopId)?.name ?? 'Unbekannter Shop';

  const toggle = async (plan: Plan): Promise<void> => {
    try {
      await api.setPlanEnabled(plan.id, !plan.enabled);
      await load();
    } catch (caught) {
      setError(caught);
    }
  };

  const runNow = async (plan: Plan): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      const response = await api.runPlan(plan.id);
      setMessage('Lauf gestartet.');
      navigate(`/laeufe/${response.run.id}`);
    } catch (caught) {
      setError(caught);
    }
  };

  const remove = async (plan: Plan): Promise<void> => {
    if (!window.confirm(`Bestellplan "${plan.name}" löschen?`)) return;
    try {
      await api.deletePlan(plan.id);
      await load();
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Bestellpläne</h1>
          <p>Was wann bestellt wird – inklusive Budget und Artikelliste.</p>
        </div>
        <Link className="button primary" to="/plaene/neu">
          Neuer Bestellplan
        </Link>
      </div>

      <ErrorNotice error={error} />
      {message && <Notice kind="ok">{message}</Notice>}
      {shops.length === 0 && (
        <Notice kind="warn">
          Es ist noch kein Shop angelegt. <Link to="/shops">Zuerst einen Shop hinzufügen.</Link>
        </Notice>
      )}

      {!plans ? (
        <Spinner />
      ) : plans.length === 0 ? (
        <div className="card">
          <Empty>Noch kein Bestellplan vorhanden.</Empty>
        </div>
      ) : (
        plans.map((plan) => (
          <div className="card" key={plan.id}>
            <div className="card-title">
              <div>
                <h2 style={{ marginBottom: 0 }}>
                  <Link to={`/plaene/${plan.id}`}>{plan.name}</Link>
                </h2>
                <span className="muted">{shopName(plan.shopId)}</span>
              </div>
              <div className="row">
                {plan.busy && <span className="badge info">läuft</span>}
                {plan.dryRun && <span className="badge">Testlauf</span>}
                {plan.confirmOrder && !plan.dryRun && <span className="badge warn">bestellt echt</span>}
                <span className={`badge ${plan.enabled ? 'ok' : ''}`}>
                  {plan.enabled ? 'Aktiv' : 'Pausiert'}
                </span>
              </div>
            </div>

            <div className="grid cols-4">
              <div>
                <div className="label muted">Rhythmus</div>
                <div>{plan.scheduleLabel}</div>
              </div>
              <div>
                <div className="label muted">Nächster Termin</div>
                <div>
                  {plan.enabled ? formatDateTime(plan.nextRunAt) : '–'}
                  {plan.enabled && plan.nextRunAt && (
                    <div className="muted">{formatRelative(plan.nextRunAt)}</div>
                  )}
                </div>
              </div>
              <div>
                <div className="label muted">Budget</div>
                <div>{formatCents(plan.maxTotalCents)}</div>
              </div>
              <div>
                <div className="label muted">Artikel</div>
                <div>{plan.items.length}</div>
              </div>
            </div>

            <div className="row" style={{ marginTop: '0.9rem' }}>
              <button type="button" className="primary" onClick={() => void runNow(plan)} disabled={plan.busy}>
                Jetzt ausführen
              </button>
              <button type="button" onClick={() => void toggle(plan)}>
                {plan.enabled ? 'Pausieren' : 'Aktivieren'}
              </button>
              <Link className="button" to={`/plaene/${plan.id}`}>
                Bearbeiten
              </Link>
              <Link className="button" to={`/laeufe?plan=${plan.id}`}>
                Läufe
              </Link>
              <button type="button" className="danger small" onClick={() => void remove(plan)}>
                Löschen
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
