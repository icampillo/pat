'use client';
import type { SaveAction } from '@/components/forms';
import type { AppState } from '@/shared/types';
import Link from 'next/link';
import { useState } from 'react';

import { WalletAddForm } from './add-form';
import { WalletConnectionCard } from './connection-card';
import { WalletPositions } from './positions';
export function WalletsPage({ state, save }: { state: AppState; save: SaveAction }) {
  const { wallets, config } = state.onchain;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {' '}
      {!wallets.length && config.mode === 'PUBLIC' && (
        <div className="notice">
          Mode gratuit prêt. Ajoutez votre adresse : la lecture DeBank démarre automatiquement, sans
          clé API.
        </div>
      )}
      <WalletAddForm save={save} busy={busy} run={run} />{' '}
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      {config.configured && (
        <div className="wallet-source">
          <span className="tag">
            DeBank {config.mode === 'PUBLIC' ? 'gratuit' : 'API'} ·{' '}
            {config.enabled ? `Automatique · ${config.intervalMinutes} min` : 'En pause'}
          </span>
          <Link href="/settings#debank" className="text-link">
            Configurer la source
          </Link>
        </div>
      )}
      {wallets.length > 0 && (
        <>
          <div className="wallet-cards">
            {wallets.map((wallet) => (
              <WalletConnectionCard
                key={wallet.id}
                wallet={wallet}
                config={config}
                save={save}
                busy={busy}
                run={run}
              />
            ))}
          </div>
          <WalletPositions state={state} />
        </>
      )}
    </>
  );
}
