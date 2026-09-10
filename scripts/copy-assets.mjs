// Kopiert Nicht-TypeScript-Dateien, die zur Laufzeit gebraucht werden.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/db', { recursive: true });
copyFileSync('src/db/schema.sql', 'dist/db/schema.sql');
console.log('[autohouse] schema.sql nach dist/db kopiert');
