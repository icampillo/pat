'use client';
import type { AppState } from '@/shared/types';
import { ExternalLink, Wallet } from 'lucide-react';
import Link from 'next/link';

export function WalletSummary({ state, currency }: { state: AppState; currency: 'EUR' | 'USD' }) {
  const { onchain } = state;
  if (!onchain.wallets.length)
    return (
      <section className="panel wallet-summary">
        <div>
          <h2>Vos cryptos, automatiquement</h2>
          <p className="muted">
            Ajoutez une adresse pour suivre les soldes, le staking et la DeFi avec DeBank.
          </p>
        </div>
        <Link className="btn" href="/wallets">
          <Wallet size={16} />
          Connecter une adresse
        </Link>
      </section>
    );
  const value = currency === 'EUR' ? onchain.valueEur : onchain.valueUsd;
  return (
    <section className="panel wallet-summary">
      <div>
        <h2>Wallets & DeFi</h2>
        <p className="muted">
          {onchain.includedCount} adresse(s) incluse(s) ·{' '}
          {onchain.staleCount ? 'Dernières valeurs connues à actualiser' : 'Source DeBank'} · Coût
          d’achat inconnu
        </p>
      </div>
      <strong>
        {value === null
          ? 'En attente de valorisation'
          : new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(Number(value))}
      </strong>
      <Link className="btn" href="/wallets">
        Voir les positions <ExternalLink size={14} />
      </Link>
    </section>
  );
}
