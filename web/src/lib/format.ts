export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '–';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export function parseEuroInput(value: string): number | null {
  const normalized = value.replace(/[^\d,.-]/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export function centsToEuroInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '–';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '–';
  const diffMinutes = Math.round((target - Date.now()) / 60_000);
  const abs = Math.abs(diffMinutes);
  const formatter = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
  if (abs < 60) return formatter.format(diffMinutes, 'minute');
  if (abs < 60 * 24) return formatter.format(Math.round(diffMinutes / 60), 'hour');
  return formatter.format(Math.round(diffMinutes / (60 * 24)), 'day');
}

export const WEEKDAYS = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
];

export const RUN_STATUS_LABEL: Record<string, string> = {
  queued: 'Wartet',
  running: 'Läuft',
  success: 'Erfolgreich',
  partial: 'Teilweise',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
  needs_action: 'Aktion nötig',
};

export const ITEM_STATUS_LABEL: Record<string, string> = {
  ordered: 'Bestellt',
  unavailable: 'Nicht verfügbar',
  too_expensive: 'Zu teuer',
  budget_skip: 'Budget',
  error: 'Fehler',
};
