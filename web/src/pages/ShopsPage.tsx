import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { Empty, ErrorNotice, Notice, Spinner } from '../components/ui';
import type { ProviderSlug, Shop } from '../lib/types';

const EMPTY_FORM = {
  provider: 'rewe' as ProviderSlug,
  name: '',
  postalCode: '',
  marketId: '',
  username: '',
  password: '',
};

export function ShopsPage() {
  const { meta } = useSession();
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Shop | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      const response = await api.shops();
      setShops(response.shops);
    } catch (caught) {
      setError(caught);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startCreate = (): void => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
  };

  const startEdit = (shop: Shop): void => {
    setEditing(shop);
    setForm({
      provider: shop.provider,
      name: shop.name,
      postalCode: shop.postalCode ?? '',
      marketId: shop.marketId ?? '',
      username: '',
      password: '',
    });
    setShowForm(true);
    setError(null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const payload: Record<string, unknown> = {
      provider: form.provider,
      name: form.name,
      postalCode: form.postalCode ? form.postalCode : null,
      marketId: form.marketId ? form.marketId : null,
    };
    // Leere Felder lassen bestehende Zugangsdaten unangetastet.
    if (form.username && form.password) {
      payload.credentials = { username: form.username, password: form.password };
    }

    try {
      if (editing) await api.updateShop(editing.id, payload);
      else await api.createShop(payload);
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (caught) {
      setError(caught);
    }
  };

  const test = async (shop: Shop): Promise<void> => {
    setBusyId(shop.id);
    setMessage(null);
    setError(null);
    try {
      const response = await api.testShop(shop.id);
      setMessage(
        `${shop.name}: ${response.result.ok ? 'Verbindung steht.' : 'Fehlgeschlagen.'} ${
          response.result.message ?? ''
        }`.trim(),
      );
      await load();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (shop: Shop): Promise<void> => {
    if (!window.confirm(`Shop "${shop.name}" mit allen Bestellplänen löschen?`)) return;
    try {
      await api.deleteShop(shop.id);
      await load();
    } catch (caught) {
      setError(caught);
    }
  };

  const clearSession = async (shop: Shop): Promise<void> => {
    try {
      await api.clearShopSession(shop.id);
      setMessage(`Gespeicherte Browser-Session von "${shop.name}" wurde verworfen.`);
      await load();
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Shops</h1>
          <p>Konten, mit denen AutoHouse bestellt. Zugangsdaten werden verschlüsselt gespeichert.</p>
        </div>
        <button type="button" className="primary" onClick={startCreate}>
          Shop hinzufügen
        </button>
      </div>

      <ErrorNotice error={error} />
      {message && <Notice kind="ok">{message}</Notice>}
      {meta && !meta.encryptionConfigured && (
        <Notice kind="warn">
          Ohne <span className="mono">ENCRYPTION_KEY</span> in der <span className="mono">.env</span>{' '}
          lassen sich keine Zugangsdaten speichern.
        </Notice>
      )}

      {showForm && (
        <form className="card" onSubmit={(event) => void submit(event)}>
          <div className="card-title">
            <h2>{editing ? `Shop bearbeiten: ${editing.name}` : 'Neuer Shop'}</h2>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="provider">Shop-Typ</label>
              <select
                id="provider"
                value={form.provider}
                disabled={Boolean(editing)}
                onChange={(event) => setForm({ ...form, provider: event.target.value as ProviderSlug })}
              >
                {(meta?.providers ?? []).map((provider) => (
                  <option key={provider.provider} value={provider.provider}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="shop-name">Bezeichnung</label>
              <input
                id="shop-name"
                required
                value={form.name}
                placeholder="z. B. REWE Lieferservice zuhause"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
          </div>

          {form.provider === 'rewe' && (
            <div className="field-row">
              <div className="field">
                <label htmlFor="plz">
                  Postleitzahl
                  <span className="hint">Bestimmt das Liefergebiet und das Sortiment.</span>
                </label>
                <input
                  id="plz"
                  inputMode="numeric"
                  maxLength={5}
                  value={form.postalCode}
                  onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="market">
                  Markt-ID (optional)
                  <span className="hint">Nur nötig, wenn mehrere Lieferservices verfügbar sind.</span>
                </label>
                <input
                  id="market"
                  value={form.marketId}
                  onChange={(event) => setForm({ ...form, marketId: event.target.value })}
                />
              </div>
            </div>
          )}

          <fieldset>
            <legend>Zugangsdaten</legend>
            <p className="muted" style={{ marginTop: 0 }}>
              {editing?.hasCredentials
                ? 'Es sind bereits Zugangsdaten hinterlegt. Felder leer lassen, um sie unverändert zu lassen.'
                : 'Optional. Alternativ kannst du dich einmalig über den Login-Assistenten anmelden (siehe README).'}
            </p>
            <div className="field-row">
              <div className="field">
                <label htmlFor="shop-user">E-Mail / Benutzername</label>
                <input
                  id="shop-user"
                  autoComplete="off"
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="shop-pass">Passwort</label>
                <input
                  id="shop-pass"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
              </div>
            </div>
          </fieldset>

          <div className="row">
            <button type="submit" className="primary">
              Speichern
            </button>
            <button type="button" onClick={() => setShowForm(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {!shops ? (
        <Spinner />
      ) : shops.length === 0 ? (
        <div className="card">
          <Empty>Noch kein Shop angelegt. Für einen gefahrlosen Test eignet sich der Demo-Shop.</Empty>
        </div>
      ) : (
        <div className="grid cols-2">
          {shops.map((shop) => (
            <div className="card" key={shop.id}>
              <div className="card-title">
                <h2>{shop.name}</h2>
                <span className={`badge ${shop.connectionStatus === 'ok' ? 'ok' : shop.connectionStatus === 'error' ? 'error' : ''}`}>
                  {shop.connectionStatus === 'ok'
                    ? 'Verbunden'
                    : shop.connectionStatus === 'error'
                      ? 'Problem'
                      : 'Ungeprüft'}
                </span>
              </div>

              <table>
                <tbody>
                  <tr>
                    <td className="muted">Typ</td>
                    <td>{meta?.providers.find((p) => p.provider === shop.provider)?.label ?? shop.provider}</td>
                  </tr>
                  {shop.postalCode && (
                    <tr>
                      <td className="muted">PLZ</td>
                      <td>{shop.postalCode}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="muted">Zugangsdaten</td>
                    <td>{shop.hasCredentials ? 'hinterlegt' : 'keine'}</td>
                  </tr>
                  <tr>
                    <td className="muted">Browser-Session</td>
                    <td>
                      {shop.hasSession
                        ? `gespeichert (gültig bis ${formatDateTime(shop.sessionValidUntil)})`
                        : 'keine'}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">Zuletzt geprüft</td>
                    <td>{formatDateTime(shop.lastCheckedAt)}</td>
                  </tr>
                </tbody>
              </table>

              {shop.connectionMessage && (
                <p className="muted" style={{ marginBottom: 0 }}>
                  {shop.connectionMessage}
                </p>
              )}

              <div className="row" style={{ marginTop: '0.9rem' }}>
                <button type="button" onClick={() => void test(shop)} disabled={busyId === shop.id}>
                  {busyId === shop.id ? 'Prüfe …' : 'Verbindung testen'}
                </button>
                <button type="button" onClick={() => startEdit(shop)}>
                  Bearbeiten
                </button>
                {shop.hasSession && (
                  <button type="button" className="small" onClick={() => void clearSession(shop)}>
                    Session verwerfen
                  </button>
                )}
                <button type="button" className="danger small" onClick={() => void remove(shop)}>
                  Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
