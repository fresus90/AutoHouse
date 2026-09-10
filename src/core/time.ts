/**
 * Zeitzonen-Helfer ohne externe Abhaengigkeit.
 *
 * Bestelltermine werden als lokale Wanduhrzeit gepflegt ("jeden Dienstag um
 * 08:00 Europe/Berlin"). Gespeichert wird immer UTC (ISO-String).
 */

export interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sonntag .. 6 = Samstag
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
}

export function toZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0';
  const hour = Number(pick('hour'));
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    // Intl liefert in en-US fuer Mitternacht je nach Engine "24"
    hour: hour === 24 ? 0 : hour,
    minute: Number(pick('minute')),
    second: Number(pick('second')),
    weekday: Math.max(0, WEEKDAYS.indexOf(pick('weekday'))),
  };
}

/** Offset der Zeitzone zu UTC in Minuten fuer den gegebenen Zeitpunkt. */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = toZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * Wandelt eine lokale Wanduhrzeit in den passenden UTC-Zeitpunkt.
 * Zwei Durchlaeufe reichen, um Sommer-/Winterzeitwechsel korrekt zu treffen.
 */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = new Date(naive);
  for (let i = 0; i < 2; i += 1) {
    const offset = zoneOffsetMinutes(result, timeZone);
    const next = new Date(naive - offset * 60_000);
    if (next.getTime() === result.getTime()) break;
    result = next;
  }
  return result;
}

/** "HH:MM" -> { hour, minute }; faellt bei Unsinn auf 08:00 zurueck. */
export function parseTimeOfDay(value: string | null | undefined): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) return { hour: 8, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return { hour, minute };
}

/** "YYYY-MM-DD" -> Bestandteile, sonst null. */
export function parseDateOnly(
  value: string | null | undefined,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? '').trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function formatZoned(date: Date, timeZone: string): string {
  const p = toZonedParts(date, timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}
