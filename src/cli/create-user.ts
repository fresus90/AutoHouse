/**
 * Legt ein Benutzerkonto an.
 *   npm run user:create -- --email ich@example.de --password "..." [--name "Tim"]
 * Ohne --password wird eines erzeugt und ausgegeben.
 */
import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { createUser, findUserByEmail } from '../db/repo/users.js';
import { parseArgs } from './args.js';

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const email = args.get('email', 'e');
  if (!email) {
    console.error('Aufruf: npm run user:create -- --email <adresse> [--password <pw>] [--name <name>]');
    process.exit(1);
  }
  db();
  if (findUserByEmail(email)) {
    console.error(`Es gibt bereits ein Konto fuer ${email}.`);
    process.exit(1);
  }
  const password = args.get('password') ?? randomBytes(12).toString('base64url');
  const user = createUser(email, password, args.get('name'));
  console.log(`Konto angelegt: ${user.email}`);
  if (!args.get('password')) console.log(`Passwort: ${password}`);
}

main();
