import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Minimaler .env-Loader – bewusst ohne zusaetzliche Abhaengigkeit. */
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.resolve(process.cwd(), '.env'));

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureDir(dir: string): string {
  const abs = path.resolve(process.cwd(), dir);
  mkdirSync(abs, { recursive: true });
  return abs;
}

const databaseFile = path.resolve(
  process.cwd(),
  process.env.DATABASE_FILE ?? './data/autohouse.db',
);
mkdirSync(path.dirname(databaseFile), { recursive: true });

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: int('PORT', 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  databaseFile,
  artifactDir: ensureDir(process.env.ARTIFACT_DIR ?? './data/runs'),
  stateDir: ensureDir(process.env.STATE_DIR ?? './data/state'),
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  timezone: process.env.TIMEZONE ?? 'Europe/Berlin',
  scheduler: {
    enabled: bool('SCHEDULER_ENABLED', true),
    tickMs: int('SCHEDULER_TICK_MS', 30_000),
    maxConcurrentRuns: Math.max(1, int('MAX_CONCURRENT_RUNS', 1)),
  },
  /**
   * Globaler Sicherheitsschalter. Ist er false, wird der letzte Schritt
   * ("kostenpflichtig bestellen") niemals ausgeloest – unabhaengig davon, was
   * am einzelnen Bestellplan eingestellt ist.
   */
  allowRealOrders: bool('ALLOW_REAL_ORDERS', false),
  browser: {
    headless: bool('HEADLESS', true),
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    timeoutMs: int('BROWSER_TIMEOUT_MS', 45_000),
    locale: process.env.BROWSER_LOCALE ?? 'de-DE',
    slowMoMs: int('BROWSER_SLOWMO_MS', 0),
  },
  sessionTtlDays: int('SESSION_TTL_DAYS', 14),
  cookieName: process.env.SESSION_COOKIE_NAME ?? 'autohouse_session',
} as const;

export type AppConfig = typeof config;
