import assert from 'node:assert/strict';
import test from 'node:test';
import { computeNextRun, describeSchedule } from '../src/core/schedule.ts';

const BERLIN = 'Europe/Berlin';

test('woechentlicher Plan trifft den gewaehlten Wochentag', () => {
  // 2026-09-10 ist ein Donnerstag.
  const after = new Date('2026-09-10T09:00:00Z');
  const next = computeNextRun(
    { intervalUnit: 'week', intervalValue: 1, weekday: 2, timeOfDay: '08:00', timeZone: BERLIN },
    after,
  );
  assert.ok(next);
  assert.equal(next.getUTCDay(), 2, 'Dienstag erwartet');
  assert.ok(next.getTime() > after.getTime());
});

test('Sommerzeit: 08:00 Berlin entspricht 06:00 UTC', () => {
  const next = computeNextRun(
    {
      intervalUnit: 'day',
      intervalValue: 1,
      timeOfDay: '08:00',
      startDate: '2026-07-01',
      timeZone: BERLIN,
    },
    new Date('2026-06-30T12:00:00Z'),
  );
  assert.equal(next?.toISOString(), '2026-07-01T06:00:00.000Z');
});

test('Winterzeit: 08:00 Berlin entspricht 07:00 UTC', () => {
  const next = computeNextRun(
    {
      intervalUnit: 'day',
      intervalValue: 1,
      timeOfDay: '08:00',
      startDate: '2026-12-01',
      timeZone: BERLIN,
    },
    new Date('2026-11-30T12:00:00Z'),
  );
  assert.equal(next?.toISOString(), '2026-12-01T07:00:00.000Z');
});

test('Zwei-Wochen-Takt bleibt am Startdatum ausgerichtet', () => {
  const spec = {
    intervalUnit: 'week' as const,
    intervalValue: 2,
    weekday: 1,
    timeOfDay: '07:30',
    startDate: '2026-01-05', // Montag
    timeZone: BERLIN,
  };
  const first = computeNextRun(spec, new Date('2026-01-01T00:00:00Z'));
  const second = computeNextRun(spec, first!);
  assert.equal(second!.getTime() - first!.getTime(), 14 * 86_400_000);
});

test('Monatlicher Plan haelt den Tag des Monats', () => {
  const next = computeNextRun(
    { intervalUnit: 'month', intervalValue: 1, dayOfMonth: 15, timeOfDay: '10:00', timeZone: BERLIN },
    new Date('2026-09-20T00:00:00Z'),
  );
  assert.equal(next?.getUTCDate(), 15);
  assert.equal(next?.getUTCMonth(), 9, 'Oktober erwartet');
});

test('Beschreibung ist deutschsprachig und lesbar', () => {
  assert.equal(
    describeSchedule({ intervalUnit: 'week', intervalValue: 2, weekday: 4, timeOfDay: '18:00' }),
    'Alle 2 Wochen Donnerstags um 18:00 Uhr',
  );
});
