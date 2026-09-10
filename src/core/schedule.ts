import { config } from '../config.js';
import {
  parseDateOnly,
  parseTimeOfDay,
  toZonedParts,
  zonedToUtc,
  type ZonedParts,
} from './time.js';

export type IntervalUnit = 'day' | 'week' | 'month';

export interface ScheduleSpec {
  intervalUnit: IntervalUnit;
  intervalValue: number;
  /** 0 = Sonntag .. 6 = Samstag (nur bei intervalUnit = 'week') */
  weekday?: number | null;
  /** 1..28 (nur bei intervalUnit = 'month') */
  dayOfMonth?: number | null;
  timeOfDay: string;
  /** Fruehester Termin, "YYYY-MM-DD" */
  startDate?: string | null;
  timeZone?: string;
}

const MAX_STEPS = 800;

/**
 * Naechster Ausfuehrungszeitpunkt (UTC), streng groesser als `after`.
 *
 * Der Takt wird vom Startdatum aus gezaehlt, damit "alle 2 Wochen" auch nach
 * pausierten Plaenen im gleichen Rhythmus bleibt.
 */
export function computeNextRun(spec: ScheduleSpec, after: Date = new Date()): Date | null {
  const timeZone = spec.timeZone ?? config.timezone;
  const { hour, minute } = parseTimeOfDay(spec.timeOfDay);
  const step = Math.max(1, Math.floor(spec.intervalValue || 1));

  const anchorDate = parseDateOnly(spec.startDate) ?? toZonedParts(after, timeZone);
  let cursor = {
    year: anchorDate.year,
    month: anchorDate.month,
    day: anchorDate.day,
  };

  if (spec.intervalUnit === 'week') {
    const wanted = normalizeWeekday(spec.weekday);
    if (wanted !== null) cursor = alignToWeekday(cursor, wanted, timeZone);
  } else if (spec.intervalUnit === 'month') {
    const wanted = spec.dayOfMonth ?? cursor.day;
    cursor = { ...cursor, day: Math.min(28, Math.max(1, wanted)) };
  }

  for (let i = 0; i < MAX_STEPS; i += 1) {
    const candidate = zonedToUtc(cursor.year, cursor.month, cursor.day, hour, minute, timeZone);
    if (candidate.getTime() > after.getTime()) return candidate;
    cursor = advance(cursor, spec.intervalUnit, step);
  }
  return null;
}

function normalizeWeekday(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 6) return null;
  return value;
}

function alignToWeekday(
  cursor: { year: number; month: number; day: number },
  wanted: number,
  timeZone: string,
): { year: number; month: number; day: number } {
  const asDate = zonedToUtc(cursor.year, cursor.month, cursor.day, 12, 0, timeZone);
  const current = toZonedParts(asDate, timeZone).weekday;
  const delta = (wanted - current + 7) % 7;
  if (delta === 0) return cursor;
  const shifted = toZonedParts(new Date(asDate.getTime() + delta * 86_400_000), timeZone);
  return { year: shifted.year, month: shifted.month, day: shifted.day };
}

function advance(
  cursor: { year: number; month: number; day: number },
  unit: IntervalUnit,
  step: number,
): { year: number; month: number; day: number } {
  if (unit === 'month') {
    const monthIndex = cursor.month - 1 + step;
    return {
      year: cursor.year + Math.floor(monthIndex / 12),
      month: (((monthIndex % 12) + 12) % 12) + 1,
      day: cursor.day,
    };
  }
  const days = unit === 'week' ? step * 7 : step;
  const asUtc = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day) + days * 86_400_000);
  return {
    year: asUtc.getUTCFullYear(),
    month: asUtc.getUTCMonth() + 1,
    day: asUtc.getUTCDate(),
  };
}

/** Menschenlesbare Beschreibung fuer die Oberflaeche. */
export function describeSchedule(spec: ScheduleSpec): string {
  const { timeOfDay, intervalValue, intervalUnit } = spec;
  const step = Math.max(1, intervalValue);
  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  if (intervalUnit === 'week') {
    const day = normalizeWeekday(spec.weekday);
    const dayLabel = day === null ? '' : ` ${weekdays[day]}s`;
    const every = step === 1 ? 'Jede Woche' : `Alle ${step} Wochen`;
    return `${every}${dayLabel} um ${timeOfDay} Uhr`;
  }
  if (intervalUnit === 'month') {
    const every = step === 1 ? 'Jeden Monat' : `Alle ${step} Monate`;
    return `${every} am ${spec.dayOfMonth ?? 1}. um ${timeOfDay} Uhr`;
  }
  const every = step === 1 ? 'Taeglich' : `Alle ${step} Tage`;
  return `${every} um ${timeOfDay} Uhr`;
}

export type { ZonedParts };
