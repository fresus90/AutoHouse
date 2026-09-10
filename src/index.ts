import { config } from './config.js';
import { logger } from './logger.js';
import { db } from './db/index.js';
import { countUsers } from './db/repo/users.js';
import { isEncryptionConfigured } from './core/crypto.js';
import { createApp } from './http/app.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';
import { closeBrowser } from './automation/browser.js';

function preflight(): void {
  db(); // legt die Datenbank an und wendet das Schema an
  if (!isEncryptionConfigured()) {
    logger.warn(
      'ENCRYPTION_KEY ist nicht gesetzt. Shop-Zugangsdaten koennen dadurch nicht gespeichert werden.\n' +
        '  Schluessel erzeugen: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (config.allowRealOrders) {
    logger.warn('ALLOW_REAL_ORDERS=true – Bestellpläne duerfen echte, kostenpflichtige Bestellungen ausloesen.');
  } else {
    logger.info('ALLOW_REAL_ORDERS=false – alle Laeufe enden im Warenkorb (Testlauf).');
  }
  if (countUsers() === 0) {
    logger.info('Noch kein Benutzerkonto vorhanden. Beim ersten Aufruf der Oberflaeche wird eines angelegt.');
  }
}

function main(): void {
  preflight();
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`AutoHouse laeuft auf http://localhost:${config.port}`);
  });
  startScheduler();

  const shutdown = (signal: string): void => {
    logger.info(`${signal} empfangen – fahre herunter.`);
    stopScheduler();
    server.close(() => {
      void closeBrowser().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
