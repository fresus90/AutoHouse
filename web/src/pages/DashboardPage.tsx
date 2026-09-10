import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCents, formatDateTime, formatRelative } from '../lib/format';
import { useSession } from '../lib/session';
import { Empty, ErrorNotice, Notice, Spinner, StatusBadge } from '../components/ui';
import type { Dashboard } from '../lib/types';

export function DashboardPage() {
  const { meta } = useSession();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      api
        .dashboard()
        .then((response) => {
          if (active) setData(response);
        })
        .catch((caught: unknown) => {
          if (active) setError(caught);
        });
    };
    load();
    // Laufende Bestellungen sollen ohne Neuladen sichtbar werden.
    const timer = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Spinner />;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Übersicht</h1>
          <p>Was als Nächstes bestellt wird und wie die letzten Läufe ausgegangen sind.</p>
        </div>
        <Link className="button primary" to="/plaene/neu">
          Neuer Bestellplan
        </Link>
      </div>

      {meta && !meta.encryptionConfigured && (
        <Notice kind="warn">
          <strong>ENCRYPTION_KEY fehlt.</strong> Ohne Schlüssel lassen sich keine Shop-Zugangsdaten
          speichern. Schlüssel erzeugen und in <span className="mono">.env</span> eintragen:{' '}
          <span className="mono">
            node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
          </span>
        </Notice>
      )}
      {meta && !meta.allowRealOrders && (
        <Notice kind="info">
          <strong>Sicherheitsmodus aktiv.</strong> Alle Läufe enden im Warenkorb. Erst wenn in der{' '}
          <span className="mono">.env</span> <span className="mono">ALLOW_REAL_ORDERS=true</span> steht{' '}
          <em>und</em> ein Plan die Bestellbestätigung gesetzt hat, wird wirklich bestellt.
        </Notice>
      )}

      <div className="grid cols-4" style={{ marginBottom: '1.25rem' }}>
        <Stat label="Shops" value={String(data.stats.shops)} />
        <Stat label="Aktive Pläne" value={`${data.stats.activePlans} / ${data.stats.plans}`} />
        <Stat label="Läufe gesamt" value={String(data.stats.total)} />
        <Stat label="Ausgaben (30 Tage)" value={formatCents(data.stats.last30DaysCents)} />
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Nächste Bestellungen</h2>
          {data.queue.active > 0 && <span className="badge info">{data.queue.active} läuft gerade</span>}
        </div>
        {data.upcoming.length === 0 ? (
          <Empty>
            Noch keine aktiven Bestellpläne. <Link to="/plaene/neu">Jetzt einen anlegen.</Link>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Rhythmus</th>
                  <th>Nächster Termin</th>
                  <th className="num">Artikel</th>
                  <th className="num">Budget</th>
                </tr>
              </thead>
              <tbody>
                {data.upcoming.map((plan) => (
                  <tr key={plan.id}>
                    <td>
                      <Link to={`/plaene/${plan.id}`}>{plan.name}</Link>{' '}
                      {plan.dryRun && <span className="badge">Testlauf</span>}
                    </td>
                    <td className="muted">{plan.scheduleLabel}</td>
                    <td>
                      {formatDateTime(plan.nextRunAt)}
                      <div className="muted">{formatRelative(plan.nextRunAt)}</div>
                    </td>
                    <td className="num">{plan.itemCount}</td>
                    <td className="num">{formatCents(plan.maxTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Letzte Läufe</h2>
          <Link to="/laeufe">Alle ansehen</Link>
        </div>
        {data.recentRuns.length === 0 ? (
          <Empty>Es wurde noch nichts ausgeführt.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Status</th>
                  <th>Auslöser</th>
                  <th className="num">Warenkorb</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{formatDateTime(run.startedAt)}</td>
                    <td>
                      <StatusBadge status={run.status} />{' '}
                      {run.dryRun && <span className="badge">Testlauf</span>}
                    </td>
                    <td className="muted">{run.trigger === 'manual' ? 'Manuell' : 'Zeitplan'}</td>
                    <td className="num">{formatCents(run.cartTotalCents)}</td>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
