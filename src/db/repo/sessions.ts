import { get, nowIso, run } from '../index.js';
import { hashToken, newSessionToken } from '../../core/crypto.js';
import { config } from '../../config.js';

export interface SessionRecord {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export function createSession(userId: string, userAgent?: string): { token: string; expiresAt: string } {
  const { token, id } = newSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000).toISOString();
  run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    id,
    userId,
    nowIso(),
    expiresAt,
    userAgent ?? null,
  );
  return { token, expiresAt };
}

export function findSessionByToken(token: string): SessionRecord | undefined {
  const record = get<SessionRecord>('SELECT * FROM sessions WHERE id = ?', hashToken(token));
  if (!record) return undefined;
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    deleteSessionById(record.id);
    return undefined;
  }
  return record;
}

export function deleteSessionByToken(token: string): void {
  deleteSessionById(hashToken(token));
}

export function deleteSessionById(id: string): void {
  run('DELETE FROM sessions WHERE id = ?', id);
}

export function deleteSessionsForUser(userId: string): void {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function purgeExpiredSessions(): void {
  run('DELETE FROM sessions WHERE expires_at <= ?', nowIso());
}
