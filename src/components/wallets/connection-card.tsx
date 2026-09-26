'use client';
import type { SaveAction } from '@/components/forms';
import { Confirm } from '@/components/ui/confirm';
import { decimal as d } from '@/domain/money';
import { walletErrors } from '@/shared/wallets';
import { ExternalLink, Pause, Play, RefreshCw, Trash2, Wallet } from 'lucide-react';

import type { OnchainState, WalletView } from '@/shared/wallets';
import { date, usd } from './format';

export function WalletConnectionCard({
  wallet: w,
  config,
  save,
  busy,
  run,
}: {
  wallet: WalletView;
  config: OnchainState['config'];
  save: SaveAction;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <section className="panel wallet-card" key={w.id}>
      <div className="wallet-card-top">
        <span className="asset-avatar">
          <Wallet size={20} />
        </span>
        <div>
          <h2>{w.label}</h2>
          <a
            className="wallet-address"
            href={`https://debank.com/profile/${w.address}`}
            target="_blank"
            rel="noreferrer"
          >
            {w.address}
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
      <strong className="wallet-balance">{usd(w.data?.totalUsd ?? null)}</strong>
      {w.data?.source === 'DEBANK_PUBLIC' && (
        <p className="small muted">
          Lecture publique · total arrondi par DeBank
          <br />
          Fraîcheur indiquée au relevé : {w.data.updatedLabel}
        </p>
      )}
      <p className="small muted">
        Total net DeBank · {w.included ? 'Inclus dans le patrimoine' : 'Exclu du patrimoine'}
      </p>
      <p className="small">
        {!config.configured
          ? 'En attente de votre clé API'
          : !w.enabled || !config.enabled
            ? 'Synchronisation en pause'
            : w.status === 'SYNCING'
              ? 'Synchronisation en cours…'
              : w.status === 'ERROR'
                ? walletErrors[w.errorCode || 'NETWORK'] || walletErrors.NETWORK
                : !w.data
                  ? 'Première synchronisation programmée…'
                  : w.stale
                    ? 'Données anciennes · dernière valeur conservée'
                    : 'Synchronisé avec DeBank'}
      </p>
      <p className="small muted">
        Dernière réussite : {date(w.lastSuccessAt)}
        {config.enabled && w.enabled && <> · Prochaine : {date(w.nextSyncAt)}</>}
      </p>
      {!!w.data?.warnings?.length && (
        <details>
          <summary className="small">Détails partiels ({w.data.warnings.length})</summary>
          <ul className="small">
            {w.data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {w.referenceUsd !== null && (
        <div className="wallet-reference">
          <span>
            Repère saisi : {usd(w.referenceUsd)} · {date(w.referenceAt)}
          </span>
          <strong>
            {w.data
              ? `Écart actuel : ${usd(d(w.data.totalUsd).sub(w.referenceUsd).toFixed())}`
              : 'Comparaison après synchronisation'}
          </strong>
          <span>
            Variation de marché et décalage de mise à jour possibles. Cet écart n’est pas une
            plus-value.
          </span>
        </div>
      )}
      <div className="wallet-actions">
        <button
          className="btn"
          disabled={busy || !config.enabled || !w.enabled || w.status === 'SYNCING'}
          onClick={() => run(() => save(`wallets/${w.id}/sync`, 'POST', {}))}
        >
          <RefreshCw size={14} />
          Actualiser
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => run(() => save(`wallets/${w.id}`, 'PATCH', { enabled: !w.enabled }))}
        >
          {w.enabled ? <Pause size={14} /> : <Play size={14} />}
          {w.enabled ? 'Pause' : 'Reprendre'}
        </button>
        <Confirm
          title="Retirer cette adresse ?"
          description="Elle sera exclue du patrimoine et ne sera plus synchronisée. Les captures historiques sont conservées."
          onConfirm={() => run(() => save(`wallets/${w.id}`, 'DELETE', {}))}
        >
          <button className="icon-btn" aria-label={`Retirer ${w.label}`} disabled={busy}>
            <Trash2 size={16} />
          </button>
        </Confirm>
      </div>
      <label className="wallet-check">
        <input
          type="checkbox"
          checked={w.included}
          disabled={busy}
          onChange={(e) =>
            run(() => save(`wallets/${w.id}`, 'PATCH', { included: e.target.checked }))
          }
        />
        Compter dans le patrimoine
      </label>
    </section>
  );
}
