'use client';
import { errorMessage } from '@/shared/errors';
import type { SaveAction } from '@/components/forms';
import type { AppState } from '@/shared/types';
import Link from '@/components/workspace/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, X } from 'lucide-react';
import { PageHeading } from '@/components/workspace/page-heading';

import { WalletAddForm } from './add-form';
import { WalletConnectionCard } from './connection-card';
import { WalletPositions } from './positions';
export function WalletsPage({ state, save }: { state: AppState; save: SaveAction }) {
  const { wallets, config } = state.onchain;
  const params = useSearchParams();
  const [adding, setAdding] = useState(Boolean(params.get('address')));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        view="wallets"
        title="Wallets DeFi"
        actions={
          <Dialog.Root open={adding} onOpenChange={setAdding}>
            <Dialog.Trigger asChild>
              <button className="btn">
                <Plus size={16} />
                Ajouter une adresse
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="overlay" />
              <Dialog.Content className="dialog wallet-add-dialog">
                <div className="section-title">
                  <Dialog.Title>Ajouter une adresse</Dialog.Title>
                  <Dialog.Close className="icon-btn" aria-label="Fermer">
                    <X size={18} />
                  </Dialog.Close>
                </div>
                <Dialog.Description>
                  Suivre une adresse publique et ses positions DeFi.
                </Dialog.Description>
                <WalletAddForm save={save} busy={busy} run={run} onAdded={() => setAdding(false)} />
                {error && (
                  <p className="error-note" role="alert">
                    {error}
                  </p>
                )}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        }
      />
      <WalletPositions state={state} />
      <h2 className="wallet-tracked-heading">Wallets suivis</h2>
      {!wallets.length && (
        <div className="notice">
          Ajoutez une adresse EVM. La première synchronisation démarre automatiquement si Zerion est
          configuré.
        </div>
      )}
      {error && !adding && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      {
        <div className="wallet-source">
          <span className="tag">
            Zerion API · {config.enabled ? 'Automatique · quotidien' : 'En pause'}
          </span>
          <Link href="/settings#zerion" className="text-link">
            Configurer la source
          </Link>
        </div>
      }
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
        </>
      )}
    </>
  );
}
