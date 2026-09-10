import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type PlanPayload } from '../lib/api';
import { WEEKDAYS, centsToEuroInput, formatCents, formatDateTime, parseEuroInput } from '../lib/format';
import { useSession } from '../lib/session';
import { ProductPicker } from '../components/ProductPicker';
import { ErrorNotice, Notice, Spinner } from '../components/ui';
import type { PlanItem, Preview, Product, Shop } from '../lib/types';

interface EditorItem extends PlanItem {
  key: string;
}

const newItem = (): EditorItem => ({
  key: Math.random().toString(36).slice(2),
  label: '',
  externalId: null,
  searchTerm: null,
  productId: null,
  quantity: 1,
  maxUnitPriceCents: null,
  priority: 50,
  optional: false,
  allowSubstitute: false,
});

export function PlanEditorPage() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const { meta } = useSession();
  const isNew = !planId;

  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const [form, setForm] = useState({
    shopId: '',
    name: '',
    enabled: true,
    intervalUnit: 'week' as 'day' | 'week' | 'month',
    intervalValue: 1,
    weekday: 2,
    dayOfMonth: 1,
    timeOfDay: '08:00',
    startDate: '',
    maxTotal: '50,00',
    minTotal: '0,00',
    budgetStrategy: 'drop_optional' as PlanPayload['budgetStrategy'],
    deliveryPreference: 'earliest' as PlanPayload['deliveryPreference'],
    deliveryWeekday: '' as string,
    deliveryFrom: '',
    deliveryTo: '',
    dryRun: true,
    confirmOrder: false,
    notes: '',
  });
  const [items, setItems] = useState<EditorItem[]>([newItem()]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const shopResponse = await api.shops();
        if (!active) return;
        setShops(shopResponse.shops);

        if (planId) {
          const { plan } = await api.plan(planId);
          if (!active) return;
          setForm({
            shopId: plan.shopId,
            name: plan.name,
            enabled: plan.enabled,
            intervalUnit: plan.intervalUnit,
            intervalValue: plan.intervalValue,
            weekday: plan.weekday ?? 2,
            dayOfMonth: plan.dayOfMonth ?? 1,
            timeOfDay: plan.timeOfDay,
            startDate: plan.startDate ?? '',
            maxTotal: centsToEuroInput(plan.maxTotalCents),
            minTotal: centsToEuroInput(plan.minTotalCents),
            budgetStrategy: plan.budgetStrategy,
            deliveryPreference: plan.deliveryPreference,
            deliveryWeekday: plan.deliveryWeekday === null ? '' : String(plan.deliveryWeekday),
            deliveryFrom: plan.deliveryFrom ?? '',
            deliveryTo: plan.deliveryTo ?? '',
            dryRun: plan.dryRun,
            confirmOrder: plan.confirmOrder,
            notes: plan.notes ?? '',
          });
          setItems(
            plan.items.map((item) => ({
              key: item.id ?? Math.random().toString(36).slice(2),
              ...item,
            })),
          );
          const previewResponse = await api.preview(planId).catch(() => null);
          if (active && previewResponse) setPreview(previewResponse.preview);
        } else if (shopResponse.shops.length > 0) {
          setForm((current) => ({ ...current, shopId: shopResponse.shops[0]!.id }));
        }
      } catch (caught) {
        if (active) setError(caught);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [planId]);

  const selectedShop = shops.find((shop) => shop.id === form.shopId);
  const supportsSlots =
    meta?.providers.find((provider) => provider.provider === selectedShop?.provider)
      ?.supportsDeliverySlots ?? false;

  /** Grobe Summe aus den bekannten Preisen – ohne Serverabfrage. */
  const estimatedCents = useMemo(
    () =>
      items.reduce((sum, item) => {
        const price = item.maxUnitPriceCents ?? null;
        return price === null ? sum : sum + price * item.quantity;
      }, 0),
    [items],
  );

  const buildPayload = (): PlanPayload => ({
    shopId: form.shopId,
    name: form.name,
    enabled: form.enabled,
    intervalUnit: form.intervalUnit,
    intervalValue: Number(form.intervalValue),
    weekday: form.intervalUnit === 'week' ? Number(form.weekday) : null,
    dayOfMonth: form.intervalUnit === 'month' ? Number(form.dayOfMonth) : null,
    timeOfDay: form.timeOfDay,
    startDate: form.startDate || null,
    maxTotalCents: parseEuroInput(form.maxTotal) ?? 0,
    minTotalCents: parseEuroInput(form.minTotal) ?? 0,
    budgetStrategy: form.budgetStrategy,
    deliveryPreference: form.deliveryPreference,
    deliveryWeekday: form.deliveryWeekday === '' ? null : Number(form.deliveryWeekday),
    deliveryFrom: form.deliveryFrom || null,
    deliveryTo: form.deliveryTo || null,
    dryRun: form.dryRun,
    confirmOrder: form.confirmOrder,
    notes: form.notes || null,
    items: items.map((item) => ({
      productId: item.productId ?? null,
      externalId: item.externalId ?? null,
      searchTerm: item.searchTerm ?? null,
      label: item.label,
      quantity: Number(item.quantity),
      maxUnitPriceCents: item.maxUnitPriceCents ?? null,
      priority: Number(item.priority ?? 50),
      optional: Boolean(item.optional),
      allowSubstitute: Boolean(item.allowSubstitute),
    })),
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const payload = buildPayload();
      const response = isNew ? await api.createPlan(payload) : await api.updatePlan(planId!, payload);
      setSaved(true);
      const previewResponse = await api.preview(response.plan.id).catch(() => null);
      if (previewResponse) setPreview(previewResponse.preview);
      if (isNew) navigate(`/plaene/${response.plan.id}`, { replace: true });
    } catch (caught) {
      setError(caught);
    }
  };

  const applyProduct = (key: string, product: Product): void => {
    setItems((current) =>
      current.map((item) =>
        item.key === key
          ? {
              ...item,
              label: product.name,
              externalId: product.externalId,
              productId: product.id,
              maxUnitPriceCents: item.maxUnitPriceCents ?? product.priceCents,
            }
          : item,
      ),
    );
    setPickerFor(null);
  };

  if (loading) return <Spinner />;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{isNew ? 'Neuer Bestellplan' : form.name || 'Bestellplan'}</h1>
          <p>Rhythmus, Budget und Artikelliste festlegen.</p>
        </div>
        <Link className="button" to="/plaene">
          Zurück
        </Link>
      </div>

      <ErrorNotice error={error} />
      {saved && <Notice kind="ok">Gespeichert.</Notice>}
      {shops.length === 0 && (
        <Notice kind="warn">
          Ohne Shop lässt sich kein Plan speichern. <Link to="/shops">Shop anlegen.</Link>
        </Notice>
      )}

      <form onSubmit={(event) => void submit(event)}>
        <div className="card">
          <h2>Grunddaten</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="plan-name">Name</label>
              <input
                id="plan-name"
                required
                value={form.name}
                placeholder="z. B. Wocheneinkauf"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="plan-shop">Shop</label>
              <select
                id="plan-shop"
                required
                value={form.shopId}
                onChange={(event) => setForm({ ...form, shopId: event.target.value })}
              >
                <option value="">Bitte wählen …</option>
                {shops.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shop.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            <span>Plan ist aktiv und wird automatisch ausgeführt</span>
          </label>
        </div>

        <div className="card">
          <h2>Rhythmus</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="interval-value">Alle …</label>
              <input
                id="interval-value"
                type="number"
                min={1}
                max={52}
                value={form.intervalValue}
                onChange={(event) => setForm({ ...form, intervalValue: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor="interval-unit">Einheit</label>
              <select
                id="interval-unit"
                value={form.intervalUnit}
                onChange={(event) =>
                  setForm({ ...form, intervalUnit: event.target.value as 'day' | 'week' | 'month' })
                }
              >
                <option value="day">Tage</option>
                <option value="week">Wochen</option>
                <option value="month">Monate</option>
              </select>
            </div>
            {form.intervalUnit === 'week' && (
              <div className="field">
                <label htmlFor="weekday">Wochentag</label>
                <select
                  id="weekday"
                  value={form.weekday}
                  onChange={(event) => setForm({ ...form, weekday: Number(event.target.value) })}
                >
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.intervalUnit === 'month' && (
              <div className="field">
                <label htmlFor="day-of-month">Tag im Monat</label>
                <input
                  id="day-of-month"
                  type="number"
                  min={1}
                  max={28}
                  value={form.dayOfMonth}
                  onChange={(event) => setForm({ ...form, dayOfMonth: Number(event.target.value) })}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="time-of-day">
                Uhrzeit
                <span className="hint">{meta?.timezone ?? 'Europe/Berlin'}</span>
              </label>
              <input
                id="time-of-day"
                type="time"
                value={form.timeOfDay}
                onChange={(event) => setForm({ ...form, timeOfDay: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="start-date">
                Startdatum
                <span className="hint">Optional – legt den Takt fest.</span>
              </label>
              <input
                id="start-date"
                type="date"
                value={form.startDate}
                onChange={(event) => setForm({ ...form, startDate: event.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Budget</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="max-total">
                Maximale Ausgaben je Bestellung
                <span className="hint">Wird nie überschritten.</span>
              </label>
              <input
                id="max-total"
                required
                value={form.maxTotal}
                onChange={(event) => setForm({ ...form, maxTotal: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="min-total">
                Mindestbestellwert
                <span className="hint">0 = keiner. Darunter wird nicht bestellt.</span>
              </label>
              <input
                id="min-total"
                value={form.minTotal}
                onChange={(event) => setForm({ ...form, minTotal: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="strategy">Wenn das Budget nicht reicht</label>
              <select
                id="strategy"
                value={form.budgetStrategy}
                onChange={(event) =>
                  setForm({ ...form, budgetStrategy: event.target.value as PlanPayload['budgetStrategy'] })
                }
              >
                <option value="drop_optional">Artikel weglassen (nach Priorität)</option>
                <option value="reduce_qty">Mengen reduzieren</option>
                <option value="abort">Bestellung abbrechen</option>
              </select>
            </div>
          </div>
        </div>

        {supportsSlots && (
          <div className="card">
            <h2>Lieferzeitfenster</h2>
            <div className="field-row">
              <div className="field">
                <label htmlFor="delivery-pref">Auswahl</label>
                <select
                  id="delivery-pref"
                  value={form.deliveryPreference}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      deliveryPreference: event.target.value as PlanPayload['deliveryPreference'],
                    })
                  }
                >
                  <option value="earliest">Frühestmöglich</option>
                  <option value="cheapest">Günstigstes</option>
                  <option value="fixed">Nur passende Fenster</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="delivery-weekday">Wunsch-Wochentag</label>
                <select
                  id="delivery-weekday"
                  value={form.deliveryWeekday}
                  onChange={(event) => setForm({ ...form, deliveryWeekday: event.target.value })}
                >
                  <option value="">egal</option>
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="delivery-from">Frühestens</label>
                <input
                  id="delivery-from"
                  type="time"
                  value={form.deliveryFrom}
                  onChange={(event) => setForm({ ...form, deliveryFrom: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="delivery-to">Spätestens</label>
                <input
                  id="delivery-to"
                  type="time"
                  value={form.deliveryTo}
                  onChange={(event) => setForm({ ...form, deliveryTo: event.target.value })}
                />
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-title">
            <h2>Artikel</h2>
            <div className="muted">
              Geschätzt (nach bekannten Preisen): {formatCents(estimatedCents)}
            </div>
          </div>

          {items.map((item, index) => (
            <div className="item-editor" key={item.key}>
              <div className="field-row">
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label>Bezeichnung</label>
                  <input
                    required
                    value={item.label}
                    placeholder="z. B. Vollmilch 1 l"
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.key === item.key ? { ...entry, label: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>Menge</label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={item.quantity}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.key === item.key
                            ? { ...entry, quantity: Number(event.target.value) }
                            : entry,
                        ),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>
                    Preisgrenze je Stück
                    <span className="hint">leer = egal</span>
                  </label>
                  <input
                    value={centsToEuroInput(item.maxUnitPriceCents)}
                    placeholder="z. B. 1,99"
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.key === item.key
                            ? { ...entry, maxUnitPriceCents: parseEuroInput(event.target.value) }
                            : entry,
                        ),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>
                    Priorität
                    <span className="hint">0–100, höher = wichtiger</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={item.priority ?? 50}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.key === item.key
                            ? { ...entry, priority: Number(event.target.value) }
                            : entry,
                        ),
                      )
                    }
                  />
                </div>
              </div>

              <div className="row spread">
                <div className="row">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(item.optional)}
                      onChange={(event) =>
                        setItems((current) =>
                          current.map((entry) =>
                            entry.key === item.key ? { ...entry, optional: event.target.checked } : entry,
                          ),
                        )
                      }
                    />
                    <span>optional</span>
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(item.allowSubstitute)}
                      onChange={(event) =>
                        setItems((current) =>
                          current.map((entry) =>
                            entry.key === item.key
                              ? { ...entry, allowSubstitute: event.target.checked }
                              : entry,
                          ),
                        )
                      }
                    />
                    <span>Ersatzartikel erlauben</span>
                  </label>
                  {item.externalId && <span className="badge mono">#{item.externalId}</span>}
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="small"
                    disabled={!form.shopId}
                    onClick={() => setPickerFor(pickerFor === item.key ? null : item.key)}
                  >
                    {pickerFor === item.key ? 'Suche schließen' : 'Artikel suchen'}
                  </button>
                  <button
                    type="button"
                    className="small danger"
                    disabled={items.length === 1}
                    onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}
                  >
                    Entfernen
                  </button>
                </div>
              </div>

              {pickerFor === item.key && form.shopId && (
                <div style={{ marginTop: '0.7rem' }}>
                  <ProductPicker shopId={form.shopId} onPick={(product) => applyProduct(item.key, product)} />
                </div>
              )}

              {index === items.length - 1 && (
                <div style={{ marginTop: '0.7rem' }}>
                  <button type="button" onClick={() => setItems((current) => [...current, newItem()])}>
                    Weiteren Artikel hinzufügen
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Ausführung</h2>
          {meta && !meta.allowRealOrders && (
            <Notice kind="info">
              Der Server läuft im Sicherheitsmodus (<span className="mono">ALLOW_REAL_ORDERS=false</span>).
              Unabhängig von den folgenden Schaltern wird nichts kostenpflichtig bestellt.
            </Notice>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.dryRun}
              onChange={(event) => setForm({ ...form, dryRun: event.target.checked })}
            />
            <span>
              Testlauf – Warenkorb füllen, aber nicht bestellen
              <span className="hint">Empfohlen, bis alles wie gewünscht aussieht.</span>
            </span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.confirmOrder}
              disabled={form.dryRun}
              onChange={(event) => setForm({ ...form, confirmOrder: event.target.checked })}
            />
            <span>
              Bestellung kostenpflichtig abschicken
              <span className="hint">Wirkt nur, wenn der Testlauf oben ausgeschaltet ist.</span>
            </span>
          </label>
          <div className="field" style={{ marginTop: '0.8rem' }}>
            <label htmlFor="notes">Notizen</label>
            <textarea
              id="notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </div>
        </div>

        <div className="row">
          <button type="submit" className="primary">
            {isNew ? 'Plan anlegen' : 'Änderungen speichern'}
          </button>
          <Link className="button" to="/plaene">
            Abbrechen
          </Link>
        </div>
      </form>

      {preview && <PreviewCard preview={preview} />}
    </>
  );
}

function PreviewCard({ preview }: { preview: Preview }) {
  const ratio = Math.min(1, preview.totalCents / Math.max(1, preview.maxTotalCents));
  return (
    <div className="card">
      <div className="card-title">
        <h2>Vorschau</h2>
        <span className="muted">
          {formatCents(preview.totalCents)} von {formatCents(preview.maxTotalCents)}
        </span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Gerechnet mit den zuletzt bekannten Preisen. Beim echten Lauf zählen die Preise im Shop.
      </p>
      <div className={`progress ${preview.totalCents > preview.maxTotalCents ? 'over' : ''}`}>
        <div style={{ width: `${ratio * 100}%` }} />
      </div>

      {preview.requiredDropped && (
        <Notice kind="warn">
          Mindestens ein Pflichtartikel passt nicht ins Budget oder ist nicht auffindbar.
        </Notice>
      )}
      {preview.aborted && <Notice kind="error">{preview.abortReason}</Notice>}

      <div className="table-wrap" style={{ marginTop: '0.8rem' }}>
        <table>
          <thead>
            <tr>
              <th>Artikel</th>
              <th className="num">Menge</th>
              <th className="num">Stückpreis</th>
              <th className="num">Summe</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {preview.lines.map((line, index) => (
              <tr key={`${line.label}-${index}`}>
                <td>
                  {line.label}
                  {line.message && <div className="muted">{line.message}</div>}
                </td>
                <td className="num">
                  {line.quantity}
                  {line.quantity !== line.requestedQuantity && (
                    <span className="muted"> / {line.requestedQuantity}</span>
                  )}
                </td>
                <td className="num">{line.priceKnown ? formatCents(line.unitPriceCents) : 'unbekannt'}</td>
                <td className="num">{formatCents(line.totalCents)}</td>
                <td>
                  <span
                    className={`badge ${
                      line.status === 'ordered' ? 'ok' : line.status === 'unavailable' ? 'error' : 'warn'
                    }`}
                  >
                    {line.status === 'ordered'
                      ? 'eingeplant'
                      : line.status === 'unavailable'
                        ? 'kein Preis'
                        : line.status === 'too_expensive'
                          ? 'zu teuer'
                          : 'Budget'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        Stand: {formatDateTime(new Date().toISOString())}
      </p>
    </div>
  );
}
