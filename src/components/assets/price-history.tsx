'use client';
import { History } from 'lucide-react';
import { useState } from 'react';

import { date, money } from '@/components/workspace/display';
export function PriceHistoryList({ id, currency }: { id: string; currency: string }) {
  const [prices, setPrices] = useState<
      { id: string; price: string; observedAt: string; source: string }[] | null
    >(null),
    [error, setError] = useState('');
  return (
    <div className="price-history">
      <button
        className="text-link"
        onClick={async () => {
          try {
            const res = await fetch(`/api/v1/assets/${id}/prices`);
            if (!res.ok) throw new Error();
            const data = await res.json();
            setPrices(data.data);
          } catch {
            setError('Historique indisponible.');
          }
        }}
      >
        Consulter l’historique des prix <History size={15} />
      </button>
      {error && <p role="alert">{error}</p>}
      {prices && (
        <div className="price-list">
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
        </div>
      )}
    </div>
  );
}
