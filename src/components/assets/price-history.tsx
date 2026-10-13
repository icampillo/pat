'use client';
import { BusyLabel } from '@/components/ui/busy-label';
import { History } from 'lucide-react';
import { readApiResponse } from '@/components/workspace/api';
import { useState } from 'react';

import { date, money } from '@/components/workspace/display';
export function PriceHistoryList({ id, currency }: { id: string; currency: string }) {
  const [prices, setPrices] = useState<
      { id: string; price: string; observedAt: string; source: string }[] | null
    >(null),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  async function load(next = false) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/v1/assets/${id}/prices${next && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        { cache: 'no-store' },
      );
      const result = await readApiResponse<{
        items: NonNullable<typeof prices>;
        nextCursor: string | null;
      }>(res, 'Historique indisponible.');
      setPrices((previous) => (next ? [...(previous ?? []), ...result.items] : result.items));
      setCursor(result.nextCursor);
      setOpen(true);
    } catch {
      setError('Historique indisponible.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="price-history">
      <button
        className="text-link"
        disabled={loading}
        aria-busy={loading}
        onClick={() => (prices ? setOpen(!open) : void load())}
      >
        <BusyLabel busy={loading} pending="Chargement des prix…">
          {open ? 'Masquer l’historique des prix' : 'Consulter l’historique des prix'}
        </BusyLabel>{' '}
        <History size={15} />
      </button>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      {open && prices && (
        <div className="price-list">
          {!prices.length && <p className="empty-inline">Aucun cours enregistré pour cet actif.</p>}
          {prices.map((p) => (
            <div key={p.id}>
              <span>{date(p.observedAt)}</span>
              <strong>{money(p.price, currency)}</strong>
              <small className="muted">
                {p.source.startsWith('gold-api:')
                  ? 'Métal spot · Gold API, change BCE'
                  : p.source === 'import-xlsx-cached'
                    ? 'Valeur indicative importée'
                    : p.source}
              </small>
            </div>
          ))}
          {cursor && (
            <button
              className="text-link"
              disabled={loading}
              aria-busy={loading}
              onClick={() => void load(true)}
            >
              Charger les cours précédents
            </button>
          )}
        </div>
      )}
    </div>
  );
}
