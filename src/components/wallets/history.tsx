'use client';
import { useState } from 'react';
import { EvolutionChart } from '@/components/charts';
import { filterCategoryHistory } from '@/domain/categories';
import { readApiResponse } from '@/components/workspace/api';

type History = { points: { date: string; value: string }[]; asOf: string };
export function WalletHistory({ id }: { id: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  return (
    <div>
      <button
        className="text-link"
        disabled={loading}
        aria-busy={loading}
        onClick={async () => {
          if (history) {
            setOpen(!open);
            return;
          }
          setLoading(true);
          setError('');
          try {
            const result = await readApiResponse<History>(
              await fetch(`/api/v1/wallets/${id}/history`, { cache: 'no-store' }),
              'Historique indisponible.',
            );
            setHistory(result);
            setOpen(true);
          } catch {
            setError('Historique indisponible.');
          } finally {
            setLoading(false);
          }
        }}
      >
        {open ? 'Masquer la courbe du wallet' : 'Consulter la courbe du wallet'}
      </button>
      {error && <p role="alert">{error}</p>}
      {open && history && (
        <>
          <p className="small muted">
            Observations en USD · dernier relevé réel de chaque jour, sans conversion au taux
            actuel.
          </p>
          <label>
            Période{' '}
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              {Object.entries({
                '7d': '7j',
                '30d': '30j',
                '90d': '90j',
                '1y': '1an',
                all: 'Tout',
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <EvolutionChart
            points={filterCategoryHistory(
              history.points.map((point) => ({ ...point, value: Number(point.value) })),
              period,
              history.asOf,
            )}
            currency="USD"
            label="Wallet"
          />
        </>
      )}
    </div>
  );
}
