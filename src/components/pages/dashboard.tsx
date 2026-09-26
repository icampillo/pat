'use client';
import { AssetCategoryCard } from '@/components/asset-category-card';
import { AllocationChart, EvolutionChart } from '@/components/charts';
import { buildCategoryDetails } from '@/domain/categories';
import { dietz } from '@/domain/ledger';
import { decimal as d } from '@/domain/money';
import type { AppState } from '@/shared/types';
import { ArrowDownRight, ArrowUpRight, Coins } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useWorkspace } from '@/components/workspace/context';
import { date, Empty, money } from '@/components/workspace/display';
import { PageHeading } from '@/components/workspace/page-heading';

export function DashboardPage({ state }: { state: AppState }) {
  const { currency } = useWorkspace();
  const [period, setPeriod] = useState('1y');
  const total = currency === 'EUR' ? state.totals.valueEur : state.totals.valueUsd;
  const categoryDetails = state.categories.map((item) =>
    buildCategoryDetails(state, item, currency),
  );
  const days = ({ '24h': 1, '7d': 7, '30d': 30, '1y': 365, all: 10000 } as Record<string, number>)[
    period
  ];
  const startTime = Date.parse(state.asOf) - days * 86400000;
  const baseline = [...state.snapshots]
    .reverse()
    .find((s) => Date.parse(s.capturedAt) <= startTime);
  const visibleSnapshots = state.snapshots.filter(
    (s) => Date.parse(s.capturedAt) >= (baseline ? Date.parse(baseline.capturedAt) : startTime),
  );
  const points = visibleSnapshots.map((s) => ({
    date: s.capturedAt,
    value:
      (currency === 'EUR' ? s.totalEur : s.totalUsd) === null
        ? null
        : Number(currency === 'EUR' ? s.totalEur : s.totalUsd),
  }));
  const slices = categoryDetails
    .filter((item) => item.category.totalValue !== null && item.category.totalValue > 0)
    .map(({ category }) => ({
      name: category.name,
      color: category.color,
      value: category.totalValue!,
    }));
  const cashTotal = state.cash.reduce(
    (sum, c) => sum.add((currency === 'EUR' ? c.valueEur : c.valueUsd) || 0),
    d(0),
  );
  if (cashTotal.gt(0))
    slices.push({ name: 'Liquidités', color: '#a0adbd', value: Number(cashTotal) });
  const first = visibleSnapshots[0];
  const adjusted =
    !state.rows.some((asset) => asset.category.key === 'REAL_ESTATE') &&
    !state.totals.incompleteCostBasis &&
    !state.onchain.includedCount &&
    !state.snapshots.some((s) => s.kind === 'WALLET') &&
    !state.historyRevised &&
    currency === 'EUR' &&
    first?.totalEur &&
    state.totals.valueEur
      ? dietz(first.totalEur, state.totals.valueEur, first.capturedAt, state.asOf, state.flows)
      : null;
  return (
    <>
      <PageHeading view="dashboard" title="Vue d’ensemble" />
      <>
        <div className="charts-grid">
          <section className="panel evolution">
            <div className="section-title">
              <div>
                <h2>Évolution du patrimoine</h2>
                <p>
                  {first
                    ? `Depuis le ${date(first.capturedAt)}`
                    : 'Vos prochaines captures apparaîtront ici'}
                </p>
              </div>
              <div className="periods">
                {[
                  ['24h', '24 h'],
                  ['7d', '7 j'],
                  ['30d', '30 j'],
                  ['1y', '1 an'],
                  ['all', 'Tout'],
                ].map(([v, l]) => (
                  <button
                    aria-pressed={period === v}
                    key={v}
                    className={period === v ? 'selected' : ''}
                    onClick={() => setPeriod(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-summary">
              <strong>{money(total, currency)}</strong>
              {adjusted !== null && (
                <span
                  className={d(adjusted).gte(0) ? 'trend-pill positive' : 'trend-pill negative'}
                >
                  {d(adjusted).gte(0) ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{' '}
                  {Number(adjusted).toFixed(2)} % <span>après flux · estimé</span>
                </span>
              )}
            </div>
            <EvolutionChart points={points} currency={currency} />
            <div className="chart-foot">
              <span className="dot purple" /> Valeur totale du portefeuille
              <Link href="/history">
                Voir l’historique <ArrowUpRight size={14} />
              </Link>
            </div>
            {state.rows.some((asset) => asset.category.key === 'REAL_ESTATE') && (
              <p className="small muted">
                L’évolution inclut le remboursement du capital immobilier. Le rendement global après
                flux est indisponible tant que ces flux ne sont pas suivis.
              </p>
            )}
          </section>
          <section className="panel allocation">
            <div className="section-title">
              <div>
                <h2>Répartition</h2>
                <p>
                  {total === null
                    ? 'Valorisation incomplète · valeurs connues'
                    : 'Par catégorie d’actifs'}
                </p>
              </div>
              <Coins size={19} className="muted" />
            </div>
            {slices.length ? (
              <>
                <AllocationChart slices={slices} />
                <div className="legend">
                  {slices.map((s) => (
                    <div key={s.name}>
                      <span className="dot" style={{ background: s.color }} />
                      <span>{s.name}</span>
                      <strong>
                        {total && d(total).gt(0)
                          ? `${d(s.value).div(total).mul(100).toFixed(1)} %`
                          : '—'}
                      </strong>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="chart-empty">Votre répartition apparaîtra après un premier achat.</p>
            )}
          </section>
        </div>
        <section aria-label="Catégories détenues" className="category-grid">
          {categoryDetails
            .filter((item) => item.category.assetCount > 0)
            .map((item) => (
              <AssetCategoryCard
                key={item.category.id}
                category={item.category}
                currency={currency}
              />
            ))}
        </section>
        {!categoryDetails.some((item) => item.category.assetCount > 0) && (
          <section className="panel">
            <Empty
              title="Aucune catégorie détenue"
              text="Ajoutez votre premier actif pour suivre vos investissements."
              href="/assets/new"
              label="Ajouter un actif"
            />
          </section>
        )}
      </>
    </>
  );
}
