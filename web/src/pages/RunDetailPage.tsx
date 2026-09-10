import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ITEM_STATUS_LABEL, formatCents, formatDateTime } from '../lib/format';
import { Empty, ErrorNotice, Notice, Spinner, StatusBadge } from '../components/ui';
import type { Run, RunLogEntry } from '../lib/types';

const OPEN_STATES = new Set(['queued', 'running']);

export function RunDetailPage() {
  const { runId } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<RunLogEntry[]>([]);
  const [error, setError] = useState<unknown>(null);
  const lastLogId = useRef(0);
  const logBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runId) return;
    let active = true;
    lastLogId.current = 0;
    setLogs([]);

    void api
      .run(runId)
      .then((response) => {
        if (!active) return;
        setRun(response.run);
        const initial = response.run.logs ?? [];
        setLogs(initial);
        lastLogId.current = initial.at(-1)?.id ?? 0;
      })
      .catch((caught: unknown) => {
        if (active) setError(caught);
      });

    // Solange der Lauf offen ist, nur die neuen Protokollzeilen nachladen.
    const timer = window.setInterval(() => {
      void api
        .runLogs(runId, lastLogId.current)
        .then((response) => {
          if (!active) return;
          if (response.logs.length > 0) {
            setLogs((current) => [...current, ...response.logs]);
            lastLogId.current = response.logs.at(-1)!.id;
            logBox.current?.scrollTo({ top: logBox.current.scrollHeight });
          }
          if (!OPEN_STATES.has(response.status)) {
            window.clearInterval(timer);
            void api.run(runId).then((full) => {
              if (active) setRun(full.run);
            });
          }
        })
        .catch(() => window.clearInterval(timer));
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [runId]);

  if (error) return <ErrorNotice error={error} />;
  if (!run) return <Spinner />;

  const screenshots = (run.artifacts ?? []).filter((artifact) => artifact.kind === 'screenshot');

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Lauf vom {formatDateTime(run.startedAt)}</h1>
          <p>
            <StatusBadge status={run.status} /> {run.dryRun && <span className="badge">Testlauf</span>}{' '}
            <span className="muted">{run.trigger === 'manual' ? 'manuell gestartet' : 'per Zeitplan'}</span>
          </p>
        </div>
        <Link className="button" to="/laeufe">
          Zurück
        </Link>
      </div>

      {run.errorMessage && (
        <Notice kind={run.status === 'failed' ? 'error' : 'warn'}>{run.errorMessage}</Notice>
      )}
      {run.dryRun && run.status === 'success' && (
        <Notice kind="info">
          Testlauf: Der Warenkorb wurde vorbereitet, es wurde nichts kostenpflichtig bestellt.
        </Notice>
      )}

      <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
        <Stat label="Geplante Summe" value={formatCents(run.plannedTotalCents)} />
        <Stat label="Warenkorb" value={formatCents(run.cartTotalCents)} />
        <Stat label="Lieferung" value={run.deliverySlot ?? '–'} />
        <Stat label="Bestellnummer" value={run.orderReference ?? '–'} />
      </div>

      <div className="card">
        <h2>Artikel</h2>
        {(run.items ?? []).length === 0 ? (
          <Empty>Keine Artikel erfasst.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Artikel</th>
                  <th className="num">Bestellt</th>
                  <th className="num">Stückpreis</th>
                  <th className="num">Summe</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(run.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.label}
                      {item.message && <div className="muted">{item.message}</div>}
                    </td>
                    <td className="num">
                      {item.orderedQty} / {item.requestedQty}
                    </td>
                    <td className="num">{formatCents(item.unitPriceCents)}</td>
                    <td className="num">{formatCents(item.totalCents)}</td>
                    <td>
                      <span className={`badge ${item.status === 'ordered' ? 'ok' : 'warn'}`}>
                        {ITEM_STATUS_LABEL[item.status] ?? item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Protokoll</h2>
          {OPEN_STATES.has(run.status) && <span className="badge info">aktualisiert sich</span>}
        </div>
        <div className="log" ref={logBox}>
          {logs.length === 0 && <div className="muted">Noch keine Einträge.</div>}
          {logs.map((entry) => (
            <div className={`log-line ${entry.level}`} key={entry.id}>
              <span className="ts">{new Date(entry.ts).toLocaleTimeString('de-DE')}</span>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      </div>

      {screenshots.length > 0 && (
        <div className="card">
          <h2>Screenshots</h2>
          <div className="shots">
            {screenshots.map((artifact) => (
              <a
                key={artifact.id}
                href={api.artifactUrl(run.id, artifact.id)}
                target="_blank"
                rel="noreferrer"
              >
                <img src={api.artifactUrl(run.id, artifact.id)} alt={artifact.label ?? 'Screenshot'} />
                <div className="muted">{artifact.label}</div>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="value" style={{ fontSize: '1.1rem' }}>
        {value}
      </div>
      <div className="label">{label}</div>
    </div>
  );
}
