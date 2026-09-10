import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) return instance;
  instance = new DatabaseSync(config.databaseFile);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec('PRAGMA foreign_keys = ON;');
  instance.exec('PRAGMA busy_timeout = 5000;');
  migrate(instance);
  return instance;
}

function migrate(database: DatabaseSync): void {
  // schema.sql liegt neben dieser Datei – im Build wird sie mitkopiert,
  // im tsx-Betrieb wird sie direkt aus src/db gelesen.
  const candidates = [
    path.join(here, 'schema.sql'),
    path.join(process.cwd(), 'src/db/schema.sql'),
  ];
  const file = candidates.find((c) => {
    try {
      readFileSync(c);
      return true;
    } catch {
      return false;
    }
  });
  if (!file) throw new Error('schema.sql wurde nicht gefunden.');
  database.exec(readFileSync(file, 'utf8'));
  logger.debug(`Schema angewendet (${path.relative(process.cwd(), file)})`);
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

// ---------------------------------------------------------------------------
// Kleine Helfer rund um node:sqlite
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db()
    .prepare(sql)
    .all(...(params as never[])) as T[];
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db()
    .prepare(sql)
    .get(...(params as never[])) as T | undefined;
}

export function run(sql: string, ...params: unknown[]): void {
  db()
    .prepare(sql)
    .run(...(params as never[]));
}

/** Fuehrt fn in einer Transaktion aus. */
export function tx<T>(fn: () => T): T {
  const database = db();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export const nowIso = (): string => new Date().toISOString();

/** SQLite kennt keinen Boolean – 0/1 hin und zurueck. */
export const toInt = (value: boolean | undefined | null): number => (value ? 1 : 0);
export const toBool = (value: unknown): boolean => value === 1 || value === true;
