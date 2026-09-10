import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorNotice, Notice } from '../components/ui';

export function LoginPage() {
  const { needsSetup, refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (needsSetup) {
        await api.register(email, password, displayName || undefined);
      } else {
        await api.login(email, password);
      }
      await refresh();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={(event) => void submit(event)}>
        <h1>AutoHouse</h1>
        <p className="muted">
          {needsSetup
            ? 'Willkommen. Lege jetzt dein Konto an – danach ist die Registrierung geschlossen.'
            : 'Bitte anmelden, um Shops und Bestellpläne zu verwalten.'}
        </p>

        <ErrorNotice error={error} />
        {needsSetup && (
          <Notice kind="info">
            Das erste Konto wird zum Verwalter. Weitere Konten legst du später über{' '}
            <span className="mono">npm run user:create</span> an.
          </Notice>
        )}

        {needsSetup && (
          <div className="field">
            <label htmlFor="name">Name (optional)</label>
            <input
              id="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="email">E-Mail-Adresse</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
          />
        </div>

        <div className="field">
          <label htmlFor="password">
            Passwort
            {needsSetup && <span className="hint">Mindestens 10 Zeichen.</span>}
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
          />
        </div>

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Bitte warten …' : needsSetup ? 'Konto anlegen' : 'Anmelden'}
        </button>
      </form>
    </div>
  );
}
