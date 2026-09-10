import type { ReactNode } from 'react';
import { ApiError, isDemoMode } from '../lib/api';
import { RUN_STATUS_LABEL } from '../lib/format';

export function Notice({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'error' | 'warn' | 'ok';
  children: ReactNode;
}) {
  return <div className={`notice ${kind}`}>{children}</div>;
}

/** Zeigt Fehler inklusive Feldhinweisen aus der Server-Validierung. */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiError) {
    return (
      <Notice kind="error">
        <strong>{error.message}</strong>
        {error.details && error.details.length > 0 && (
          <ul>
            {error.details.map((detail, index) => (
              <li key={`${detail.path}-${index}`}>
                {detail.path ? `${detail.path}: ` : ''}
                {detail.message}
              </li>
            ))}
          </ul>
        )}
      </Notice>
    );
  }
  return <Notice kind="error">{error instanceof Error ? error.message : String(error)}</Notice>;
}

export function StatusBadge({ status }: { status: string }) {
  const kind =
    status === 'success'
      ? 'ok'
      : status === 'failed'
        ? 'error'
        : status === 'partial' || status === 'needs_action'
          ? 'warn'
          : 'info';
  return <span className={`badge ${kind}`}>{RUN_STATUS_LABEL[status] ?? status}</span>;
}

export function Spinner({ label = 'Wird geladen …' }: { label?: string }) {
  return <p className="muted">{label}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Nur im Demo-Build sichtbar – macht deutlich, dass nichts echt ist. */
export function DemoBanner() {
  if (!isDemoMode) return null;
  return (
    <Notice kind="info">
      <strong>Demo-Modus.</strong> Alle Daten liegen nur in diesem Browser, es
      werden keine Anfragen an dm oder REWE gestellt und nichts bestellt.
      Anmelden geht mit beliebiger E-Mail und beliebigem Passwort.
    </Notice>
  );
}
