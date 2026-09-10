import { useState } from 'react';
import { api } from '../lib/api';
import { formatCents } from '../lib/format';
import { ErrorNotice } from './ui';
import type { Product } from '../lib/types';

/**
 * Produktsuche im Shop. Die Live-Suche laeuft ueber den Shop-Treiber, Treffer
 * landen im lokalen Katalog und stehen danach auch offline zur Verfuegung.
 */
export function ProductPicker({
  shopId,
  onPick,
}: {
  shopId: string;
  onPick: (product: Product) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const search = async (live: boolean): Promise<void> => {
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const response = live
        ? await api.searchProducts(shopId, query.trim())
        : await api.cachedProducts(shopId, query.trim());
      setResults(response.products);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: '0.6rem' }}>
        <input
          value={query}
          placeholder="Artikel suchen, z. B. Vollmilch"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void search(true);
            }
          }}
          style={{ flex: '1 1 220px' }}
        />
        <button type="button" className="primary" disabled={busy} onClick={() => void search(true)}>
          {busy ? 'Suche …' : 'Im Shop suchen'}
        </button>
        <button type="button" disabled={busy} onClick={() => void search(false)}>
          Nur gespeicherte
        </button>
      </div>

      <ErrorNotice error={error} />

      {results && (
        <div className="search-results">
          {results.length === 0 && <div className="empty">Keine Treffer.</div>}
          {results.map((product) => (
            <div className="search-result" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <div className="muted">
                  {[product.brand, product.grammage, product.basePrice].filter(Boolean).join(' · ')}
                  <span className="mono"> #{product.externalId}</span>
                </div>
              </div>
              <div className="row">
                <span>{formatCents(product.priceCents)}</span>
                <button type="button" className="small primary" onClick={() => onPick(product)}>
                  Übernehmen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
