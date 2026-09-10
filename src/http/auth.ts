import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { findSessionByToken } from '../db/repo/sessions.js';
import { findUserById } from '../db/repo/users.js';
import type { User } from '../core/types.js';
import { unauthorized } from './errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

export function setSessionCookie(res: Response, token: string, expiresAt: string): void {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    expires: new Date(expiresAt),
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.cookieName, { path: '/' });
}

/** Haengt req.user an, wenn ein gueltiges Cookie vorliegt. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[config.cookieName] as string | undefined;
  if (token) {
    const session = findSessionByToken(token);
    if (session) {
      const user = findUserById(session.user_id);
      if (user) req.user = user;
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  next();
}

export function currentUser(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}
