import { Router } from 'express';
import { authenticate, changePassword, countUsers, createUser, findUserByEmail } from '../../db/repo/users.js';
import { createSession, deleteSessionByToken, deleteSessionsForUser } from '../../db/repo/sessions.js';
import { config } from '../../config.js';
import { asyncHandler, badRequest, conflict, unauthorized } from '../errors.js';
import { changePasswordSchema, loginSchema, registerSchema } from '../validation.js';
import { clearSessionCookie, currentUser, requireAuth, setSessionCookie } from '../auth.js';

export const authRouter = Router();

/** Zeigt der Anmeldeseite, ob ueberhaupt schon ein Konto existiert. */
authRouter.get('/state', (_req, res) => {
  res.json({ needsSetup: countUsers() === 0 });
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

/**
 * Registrierung ist nur fuer das allererste Konto offen. Danach legt ein
 * bestehender Nutzer weitere Konten ueber "npm run user:create" an.
 */
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const payload = registerSchema.parse(req.body);
    if (countUsers() > 0 && !req.user) throw unauthorized('Registrierung ist geschlossen.');
    if (findUserByEmail(payload.email)) throw conflict('Diese E-Mail-Adresse ist bereits vergeben.');

    const user = createUser(payload.email, payload.password, payload.displayName);
    const session = createSession(user.id, req.get('user-agent') ?? undefined);
    setSessionCookie(res, session.token, session.expiresAt);
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const payload = loginSchema.parse(req.body);
    const user = authenticate(payload.email, payload.password);
    if (!user) throw unauthorized('E-Mail-Adresse oder Passwort ist falsch.');
    const session = createSession(user.id, req.get('user-agent') ?? undefined);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ user });
  }),
);

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[config.cookieName] as string | undefined;
  if (token) deleteSessionByToken(token);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.post(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const payload = changePasswordSchema.parse(req.body);
    if (!authenticate(user.email, payload.currentPassword)) {
      throw badRequest('Das aktuelle Passwort stimmt nicht.');
    }
    changePassword(user.id, payload.newPassword);
    // Alle anderen Sitzungen beenden und eine frische ausstellen.
    deleteSessionsForUser(user.id);
    const session = createSession(user.id, req.get('user-agent') ?? undefined);
    setSessionCookie(res, session.token, session.expiresAt);
    res.status(204).end();
  }),
);
