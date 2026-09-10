import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorNotice, Notice } from '../components/ui';

export function SettingsPage() {
  const { user, meta } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setDone(false);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setDone(true);
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Einstellungen</h1>
          <p>Konto und Serverzustand.</p>
        </div>
      </div>

      <div className="card">
        <h2>Konto</h2>
        <table>
          <tbody>
            <tr>
              <td className="muted">E-Mail</td>
              <td>{user?.email}</td>
            </tr>
            <tr>
              <td className="muted">Name</td>
              <td>{user?.displayName ?? '–'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <form className="card" onSubmit={(event) => void submit(event)}>
        <h2>Passwort ändern</h2>
        <ErrorNotice error={error} />
        {done && <Notice kind="ok">Passwort geändert. Andere Sitzungen wurden abgemeldet.</Notice>}
        <div className="field-row">
          <div className="field">
            <label htmlFor="current">Aktuelles Passwort</label>
            <input
              id="current"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="next">
              Neues Passwort
              <span className="hint">Mindestens 10 Zeichen.</span>
            </label>
            <input
              id="next"
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="primary">
          Ändern
        </button>
      </form>

      <div className="card">
        <h2>Server</h2>
        <table>
          <tbody>
            <tr>
              <td className="muted">Zeitzone</td>
              <td>{meta?.timezone}</td>
            </tr>
            <tr>
              <td className="muted">Scheduler</td>
              <td>{meta?.schedulerEnabled ? 'aktiv' : 'deaktiviert'}</td>
            </tr>
            <tr>
              <td className="muted">Echte Bestellungen</td>
              <td>
                {meta?.allowRealOrders ? (
                  <span className="badge warn">erlaubt</span>
                ) : (
                  <span className="badge ok">gesperrt (nur Testläufe)</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="muted">Verschlüsselung</td>
              <td>
                {meta?.encryptionConfigured ? (
                  <span className="badge ok">eingerichtet</span>
                ) : (
                  <span className="badge error">ENCRYPTION_KEY fehlt</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="muted">Warteschlange</td>
              <td>
                {meta?.queue.active ?? 0} laufend, {meta?.queue.pending ?? 0} wartend
              </td>
            </tr>
            <tr>
              <td className="muted">Verfügbare Shop-Typen</td>
              <td>{(meta?.providers ?? []).map((provider) => provider.label).join(', ')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
