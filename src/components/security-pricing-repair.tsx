'use client';
import { useState } from 'react';
import type { AssetView } from '@/shared/types';
import type { SaveAction } from './forms';
import type { SecurityQuote } from '@/modules/prices/securities';
import { errorMessage } from '@/shared/errors';

export function SecurityPricingRepair({ asset, save }: { asset: AssetView; save: SaveAction }) {
  const [ticker, setTicker] = useState(asset.metadata.ticker || '');
  const [preview, setPreview] = useState<{ version: number; quote: SecurityQuote } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (
    asset.category.key !== 'SECURITIES' ||
    asset.status !== 'ACTIVE' ||
    (asset.metadata.pricingMode && asset.metadata.pricingMode !== 'MANUAL')
  )
    return null;
  async function run(confirmed: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await save(`securities/${asset.id}/repair`, 'POST', {
        ticker: confirmed ? preview!.quote.symbol : ticker.trim() || undefined,
        confirmed,
        ...(confirmed ? { version: preview!.version } : {}),
      });
      if (confirmed) setPreview(null);
      else setPreview(result as unknown as { version: number; quote: SecurityQuote });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel detail-panel">
      <h3>Activer les cours automatiques</h3>
      <p>
        Vérifiez la cotation avant de confirmer. Le compte, les transactions, frais, prix d’achat,
        anciens cours et snapshots resteront inchangés.
      </p>
      <label>
        Ticker de cotation (facultatif si l’ISIN est connu)
        <input
          value={ticker}
          disabled={busy}
          maxLength={40}
          onChange={(e) => {
            setTicker(e.target.value);
            setPreview(null);
          }}
        />
      </label>
      <button aria-busy={busy} className="btn" disabled={busy} onClick={() => run(false)}>
        Vérifier la cotation
      </button>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p>
            {preview.quote.symbol} · {preview.quote.exchange} · {preview.quote.price}{' '}
            {preview.quote.currency} · cours du{' '}
            {new Date(preview.quote.observedAt).toLocaleString('fr-FR')}
          </p>
          <button
            aria-busy={busy}
            className="btn primary"
            disabled={busy}
            onClick={() => run(true)}
          >
            Confirmer l’activation des cours automatiques
          </button>
        </>
      )}
    </section>
  );
}
