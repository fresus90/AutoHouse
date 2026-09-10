import { all, get, nowIso, run } from '../index.js';
import { hashPassword, newId, verifyPassword } from '../../core/crypto.js';
import type { User } from '../../core/types.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  created_at: string;
}

const map = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  createdAt: row.created_at,
});

export function createUser(email: string, password: string, displayName?: string): User {
  const id = newId('usr');
  const ts = nowIso();
  run(
    `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    email.trim().toLowerCase(),
    hashPassword(password),
    displayName ?? null,
    ts,
    ts,
  );
  return { id, email: email.trim().toLowerCase(), displayName: displayName ?? null, createdAt: ts };
}

export function findUserByEmail(email: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE email = ?', email.trim().toLowerCase());
}

export function findUserById(id: string): User | undefined {
  const row = get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  return row ? map(row) : undefined;
}

export function countUsers(): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
}

export function listUsers(): User[] {
  return all<UserRow>('SELECT * FROM users ORDER BY created_at').map(map);
}

export function authenticate(email: string, password: string): User | null {
  const row = findUserByEmail(email);
  if (!row) {
    // Konstante Arbeit, damit unbekannte E-Mails nicht schneller antworten.
    verifyPassword(password, `scrypt$16384$8$1$${'A'.repeat(24)}$${'A'.repeat(88)}`);
    return null;
  }
  return verifyPassword(password, row.password_hash) ? map(row) : null;
}

export function changePassword(userId: string, newPassword: string): void {
  run(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    hashPassword(newPassword),
    nowIso(),
    userId,
  );
}
