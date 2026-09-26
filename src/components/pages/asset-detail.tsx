'use client';
import { AssetImage } from '@/components/asset-image';
import { AssetForm } from '@/components/forms';
import { decimal as d } from '@/domain/money';
import type { AppState, AssetView } from '@/shared/types';
import {
  Archive,
  Banknote,
  Pencil,
  Plus,
  RefreshCw,
  Shapes,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PriceHistoryList } from '@/components/assets/price-history';
import { TransactionTable } from '@/components/transactions/transaction-table';
import { useWorkspace } from '@/components/workspace/context';
import { AssetAvatar, date, Metric, money, qty } from '@/components/workspace/display';
import { PageHeading } from '@/components/workspace/page-heading';

export function AssetDetailPage({ state, asset }: { state: AppState; asset: AssetView }) {
  const { currency, save, run, busy, setFlash } = useWorkspace();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const val = (a: AssetView) => (currency === 'EUR' ? a.valueEur : a.valueUsd);
  const gain = (a: AssetView) => (currency === 'EUR' ? a.gainEur : a.gainUsd);
  return (
    <>
      <PageHeading view="assets" title={asset.name} detail />
      {editing ? (
        <AssetForm
          state={state}
          asset={asset}
          save={save}
          done={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      ) : (
        <>
          <div className="detail-top">
            <div className="detail-identity">
              <AssetAvatar asset={asset} />
              <div>
                <strong>{asset.symbol}</strong>
                <p>
                  {asset.category.label} · {asset.platform}
                </p>
              </div>
            </div>
            <div className="heading-actions">
              <button className="btn" onClick={() => setEditing(true)}>
                <Pencil size={15} />
                Modifier
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    save(
                      `assets/${asset.id}`,
                      'PATCH',
                      {
                        name: asset.name,
                        symbol: asset.symbol,
                        categoryId: asset.categoryId,
                        currency: asset.currency,
                        platform: asset.platform,
                        subcategory: asset.subcategory || '',
                        externalId: asset.externalId || '',
                        notes: asset.notes,
                        metadata: asset.metadata,
                        status: asset.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED',
                      },
                      asset.version,
                    ),
                  )
                }
              >
                <Archive size={15} />
                {asset.status === 'ARCHIVED' ? 'Réactiver' : 'Archiver'}
              </button>
            </div>
          </div>
          <p className="muted">
            {asset.status === 'ARCHIVED'
              ? 'Actif archivé : historique conservé. Réactivez-le avant d’ajouter, corriger ou annuler une opération.'
              : 'L’archivage conserve tout l’historique et nécessite de solder ou corriger la position au préalable.'}
          </p>
          <div className="metrics">
            <Metric
              title="Valeur actuelle"
              value={money(val(asset), currency)}
              note={asset.priceDate ? `Prix du ${date(asset.priceDate)}` : 'Aucun prix renseigné'}
              icon={<Wallet size={18} />}
            />
            <Metric
              title="Quantité détenue"
              value={qty(asset.quantity)}
              note={asset.symbol}
              icon={<Shapes size={18} />}
            />
            <Metric
              title="Coût d’acquisition total"
              value={money(asset.costEur, 'EUR')}
              note={
                asset.metadata.costBasis === 'UNKNOWN'
                  ? 'Coût d’acquisition non renseigné'
                  : 'Montant connu pour la quantité détenue'
              }
              icon={<Banknote size={18} />}
            />
            <Metric
              title="Plus-value latente"
              value={money(gain(asset), currency)}
              note="Sur les unités encore détenues"
              icon={<TrendingUp size={18} />}
            />
          </div>
          <div className="detail-grid">
            {asset.metadata.pricingMode === 'SECURITIES_MARKET' ? (
              <section className="panel detail-panel">
                <h2>Cours automatique</h2>
                <p className="muted">
                  {asset.metadata.ticker} · {asset.metadata.exchange} · Yahoo Finance
                </p>
                <p className="small muted">
                  {asset.priceDate
                    ? `Dernier cours du ${date(asset.priceDate)}${asset.stale ? ' · cours ancien' : ''}`
                    : 'En attente de cotation.'}{' '}
                  Actualisation toutes les 15 minutes lorsque le serveur fonctionne.
                </p>
                <PriceHistoryList id={asset.id} currency={asset.currency} />
              </section>
            ) : asset.category.key === 'METALS' ? (
              <section className="panel detail-panel">
                <h2>Valeur de la pièce</h2>
                <p className="muted">
                  Calculée automatiquement avec le cours de l’or ou de l’argent, le poids et la
                  pureté indiqués sur cette fiche.
                </p>
                <p className="small muted">
                  {asset.priceDate
                    ? `Dernier cours du ${date(asset.priceDate)}${asset.stale ? ' · cours ancien' : ''}`
                    : 'En attente de la première cotation.'}
                </p>
                <PriceHistoryList id={asset.id} currency={asset.currency} />
              </section>
            ) : (
              <section className="panel detail-panel">
                <h2>Mettre à jour le prix</h2>
                <p className="muted">Chaque prix est conservé dans l’historique.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    run(() =>
                      save(`assets/${asset.id}/prices`, 'POST', {
                        price: String(fd.get('price')),
                        observedAt: new Date().toISOString(),
                      }),
                    );
                  }}
                >
                  <label>
                    Prix unitaire ({asset.currency})
                    <input
                      name="price"
                      inputMode="decimal"
                      required
                      defaultValue={asset.price || ''}
                    />
                  </label>
                  <button className="btn primary" disabled={busy}>
                    <RefreshCw size={16} />
                    Enregistrer le prix
                  </button>
                </form>
                <PriceHistoryList id={asset.id} currency={asset.currency} />
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await save(`assets/${asset.id}/refresh`, 'POST', {});
                      setFlash('Fournisseur externe non configuré : dernier prix connu conservé.');
                    })
                  }
                >
                  Vérifier la source de prix
                </button>
              </section>
            )}
            <section className="panel detail-panel">
              <h2>Informations</h2>
              <AssetImage id={asset.id} updatedAt={asset.image?.updatedAt} save={save} />
              <dl className="details-list">
                <div>
                  <dt>Statut</dt>
                  <dd>
                    {asset.status === 'ARCHIVED'
                      ? 'Archivé'
                      : d(asset.quantity).isZero()
                        ? 'Aucune position'
                        : 'Actif'}
                  </dd>
                </div>
                {Object.entries(asset.metadata)
                  .filter(
                    ([key]) =>
                      !['costBasis', 'coinType', 'pricingMode', 'gramPrice', 'premium'].includes(
                        key,
                      ),
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{metadataLabels[key] || key}</dt>
                      <dd>
                        {key === 'costBasis'
                          ? value === 'UNKNOWN'
                            ? 'Non renseigné'
                            : 'Renseigné dans les opérations'
                          : key === 'metalType'
                            ? value === 'GOLD'
                              ? 'Or'
                              : 'Argent'
                            : key === 'pricingMode' && value === 'GRAM'
                              ? 'Métal fin au gramme'
                              : key === 'pricingMode' && value === 'METAL_MARKET'
                                ? 'Cours du métal actualisé'
                                : key === 'pricingMode' && value === 'SECURITIES_MARKET'
                                  ? 'Cours boursier automatique'
                                  : String(value)}
                      </dd>
                    </div>
                  ))}
              </dl>
              {asset.notes && (
                <div className="notes">
                  <h3>Notes</h3>
                  <p>{asset.notes}</p>
                </div>
              )}
              {asset.status === 'ACTIVE' && (
                <Link className="btn" href={`/transactions/new?asset=${asset.id}`}>
                  <Plus size={16} />
                  Ajouter une transaction
                </Link>
              )}
            </section>
          </div>
          <section className="panel">
            <div className="section-title">
              <h2>Transactions de l’actif</h2>
            </div>
            <TransactionTable
              state={state}
              rows={state.transactions.filter((t) => t.assetId === asset.id)}
              save={save}
              run={run}
            />
          </section>
        </>
      )}
    </>
  );
}
const metadataLabels: Record<string, string> = {
  costBasis: 'Coût d’acquisition',
  network: 'Réseau',
  contractAddress: 'Contrat',
  stakingRate: 'Rendement indicatif',
  metalType: 'Métal',
  weightGrams: 'Poids (g)',
  purity: 'Pureté',
  gramPrice: 'Cours par gramme',
  premium: 'Prime par unité',
  coinType: 'Type de pièce',
  year: 'Année',
  country: 'Pays',
  faceValue: 'Valeur faciale',
  pricingMode: 'Mode de prix',
  ticker: 'Ticker',
  exchange: 'Marché',
  isin: 'ISIN',
  instrumentType: 'Instrument',
  setName: 'Extension',
  language: 'Langue',
  condition: 'État',
  cardNumber: 'Numéro',
  grade: 'Grade',
  gradingCompany: 'Société de grading',
  certificateNumber: 'Certification',
  referenceUrl: 'Référence externe',
};
