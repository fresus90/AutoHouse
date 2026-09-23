import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from '../config.js';
import { logger } from '../logger.js';

const log = logger.child('browser');

/**
 * Chromium-Argumente. `--disable-blink-features=AutomationControlled` entfernt
 * das offensichtlichste Automatisierungs-Merkmal; ein Wundermittel gegen
 * Bot-Erkennung ist das nicht (siehe docs/shops.md).
 */
const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-gpu',
];

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

let sharedBrowser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  log.info(`Starte Chromium (headless=${config.browser.headless})`);
  sharedBrowser = await chromium.launch({
    headless: config.browser.headless,
    args: LAUNCH_ARGS,
    slowMo: config.browser.slowMoMs || undefined,
    ...(config.browser.executablePath ? { executablePath: config.browser.executablePath } : {}),
  });
  return sharedBrowser;
}

export async function closeBrowser(): Promise<void> {
  await sharedBrowser?.close().catch(() => undefined);
  sharedBrowser = null;
}

export interface SessionHandle {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export async function createSession(options: {
  storageState?: unknown;
  headless?: boolean;
}): Promise<SessionHandle> {
  const browser =
    options.headless === undefined || options.headless === config.browser.headless
      ? await getBrowser()
      : await chromium.launch({
          headless: options.headless,
          args: LAUNCH_ARGS,
          ...(config.browser.executablePath ? { executablePath: config.browser.executablePath } : {}),
        });

  const context = await browser.newContext({
    locale: config.browser.locale,
    timezoneId: config.timezone,
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    extraHTTPHeaders: { 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.6' },
    ...(options.storageState ? { storageState: options.storageState as never } : {}),
  });
  context.setDefaultTimeout(config.browser.timeoutMs);
  context.setDefaultNavigationTimeout(config.browser.timeoutMs);

  // tsx/esbuild versieht benannte Funktionen mit einem __name-Helfer. Der
  // existiert im Seitenkontext nicht, weshalb jedes page.evaluate(...) im
  // Entwicklungsbetrieb sonst mit "__name is not defined" abbricht. Als
  // Zeichenkette uebergeben, damit der Helfer nicht selbst transformiert wird.
  await context.addInitScript({ content: 'globalThis.__name ||= (fn) => fn;' });

  // Kleine Angleichung an einen normalen Browser.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  const ownsBrowser = browser !== sharedBrowser;

  return {
    context,
    page,
    async close() {
      await context.close().catch(() => undefined);
      if (ownsBrowser) await browser.close().catch(() => undefined);
    },
  };
}

/** Screenshot + HTML in das Artefakt-Verzeichnis des Laufs schreiben. */
export async function captureArtifacts(
  page: Page,
  runId: string,
  label: string,
): Promise<{ screenshot: string; html: string }> {
  const dir = path.join(config.artifactDir, runId);
  mkdirSync(dir, { recursive: true });
  const safe = label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const stamp = String(Date.now()).slice(-6);
  const screenshot = path.join(dir, `${stamp}-${safe}.png`);
  const html = path.join(dir, `${stamp}-${safe}.html`);
  await page.screenshot({ path: screenshot, fullPage: false }).catch(() => undefined);
  await page
    .content()
    .then((content) => writeFileSync(html, content, 'utf8'))
    .catch(() => undefined);
  return { screenshot, html };
}
