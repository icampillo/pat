'use client';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import {
  CategoryCard,
  ValueChange,
  type DashboardCategory,
} from '@/components/dashboard/category-card';
import { AllocationTreemap } from '@/components/dashboard/treemap';
import { ValueChart, observationDate } from '@/components/dashboard/value-chart';
import styles from '@/components/dashboard/dashboard.module.css';
import { PortfolioAnalysisDialog } from '@/components/portfolio-analysis-dialog';
import { useWorkspace } from '@/components/workspace/context';
import { money } from '@/components/workspace/display';
import Link from '@/components/workspace/link';
import {
  buildCategoryDetails,
  calculateCategoryValue,
  filterCategoryHistory,
  numeric,
} from '@/domain/categories';
import type { AppState } from '@/shared/types';
import { availableChartPeriod } from '@/domain/dashboard';

export function DashboardPage({ state }: { state: AppState }) {
  const { currency, flash, setFlash } = useWorkspace();
  const [selectedPeriod, setPeriod] = useState<string | null>(null);
  const [selectedCategoryPeriod, setCategoryPeriod] = useState<string | null>(null);
  const field = currency === 'EUR' ? 'valueEur' : 'valueUsd';
  const total = numeric(state.totals[field]);
  const history = state.snapshots
    .map((snapshot) => ({
      date: snapshot.capturedAt,
      value: numeric(currency === 'EUR' ? snapshot.totalEur : snapshot.totalUsd),
    }))
    .filter((point) => Date.parse(point.date) <= Date.parse(state.asOf))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const categories: DashboardCategory[] = state.categories
    .map((category) => {
      const detail = buildCategoryDetails(state, category, currency);
      return {
        id: category.id,
        key: category.key,
        name: category.label,
        value: detail.category.totalValue,
        href: `/categories/${detail.category.slug}`,
        history: detail.history,
        count: detail.category.assetCount,
        note: detail.category.realEstate
          ? `Valeur nette · ${money(detail.category.realEstate.grossValue, currency)} brut détenu · ${money(detail.category.realEstate.debt, currency)} de dette. Capital remboursé inclus.`
          : undefined,
      };
    })
    .filter((item) => item.count > 0);
  if (state.cash.length)
    categories.push({
      id: 'dashboard-cash',
      key: 'CASH',
      name: 'Liquidités',
      value: calculateCategoryValue(state.cash.map((cash) => cash[field])),
      href: '/portfolio',
      history: state.snapshots
        .map((snapshot) => ({
          date: snapshot.capturedAt,
          value: numeric(snapshot.cashValues?.[field]),
        }))
        .filter((point) => Date.parse(point.date) <= Date.parse(state.asOf))
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
    });
  const period =
    selectedPeriod ??
    availableChartPeriod([history], state.asOf, ['7d', '30d', '90d', '1y', 'all']);
  const categoryPeriod =
    selectedCategoryPeriod ??
    availableChartPeriod(
      categories.map((category) => category.history),
      state.asOf,
      ['7d', '30d'],
    );
  const periodLabel = (
    { '30d': '30 j', '90d': '3 mois', '1y': '1 an', all: 'tout l’historique' } as Record<
      string,
      string
    >
  )[period];
  // Preserve the previous allocation's known-cash perimeter, not a partial card total.
  const allocationCategories = categories.map((item) =>
    item.key === 'CASH' && item.value === null
      ? {
          ...item,
          name: 'Liquidités connues',
          value: calculateCategoryValue(
            state.cash.map((cash) => cash[field]).filter((value) => value !== null),
          ),
        }
      : item,
  );
  const quoteDates = state.rows
    .filter((row) => !row.deletedAt && (numeric(row.quantity) ?? 0) > 0 && !row.realEstate)
    .map((row) => row.priceDate);
  const walletDates = state.onchain.wallets
    .filter((wallet) => wallet.included)
    .map((wallet) => wallet.lastSuccessAt);
  const dates = [...quoteDates, ...walletDates];
  const oldest = dates
    .filter((value): value is string => !!value)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return (
    <div className={styles.root}>
      <h1 className="sr-only">Vue d’ensemble</h1>
      {flash && (
        <div className={styles.flash} role="status">
          {flash}
          <button aria-label="Fermer le message" onClick={() => setFlash('')}>
            <X size={18} />
          </button>
        </div>
      )}
      <div className={styles.overview}>
        <section className={`${styles.card} ${styles.wealth}`} aria-labelledby="wealth-heading">
          <div className={styles.wealthHead}>
            <div className={styles.wealthNumbers}>
              <h2 id="wealth-heading">Valeur totale de votre patrimoine</h2>
              <div className={styles.amountRow}>
                <strong className={styles.total} data-testid="wealth-total">
                  {money(total, currency)}
                </strong>
                <ValueChange
                  value={total}
                  history={history}
                  asOf={state.asOf}
                  revised={state.historyRevised}
                />
              </div>
            </div>
            <PortfolioAnalysisDialog
              state={state}
              triggerLabel="Exporter le prompt IA"
              triggerClassName={styles.export}
            />
          </div>
          <div className={styles.mainPeriods}>
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>
          {selectedPeriod === null && period !== '7d' && (
            <p className={styles.notice} role="status">
              Pas assez de relevés sur 7 j · affichage sur {periodLabel}.
            </p>
          )}
          <ValueChart
            points={filterCategoryHistory(history, period, state.asOf)}
            currency={currency}
            name="Patrimoine"
          />
          <div className={styles.freshness}>
            <span>Situation au {observationDate(state.asOf)} · Paris</span>
            <Link href="/activity?view=history">Historique →</Link>
          </div>
          <details className={styles.sources}>
            <summary>Fraîcheur des données</summary>
            <p>
              La date de situation est celle du calcul, pas celle de tous les cours.{' '}
              {oldest
                ? `Cours / synchronisation inclus les plus anciens : ${observationDate(oldest)} (Paris).`
                : 'Aucun horodatage de cours disponible.'}{' '}
              {dates.some((date) => !date) && 'Certains cours ne sont pas horodatés.'}{' '}
              {state.fxRate &&
                `Taux EUR/USD : ${observationDate(state.fxRate.observedAt)} (Paris).`}{' '}
              Les estimations immobilières restent des saisies manuelles.
            </p>
          </details>
          {total === null && (
            <p className={styles.notice}>
              Valorisation incomplète · certains prix ou taux de change sont indisponibles.
            </p>
          )}
          {state.historyRevised && (
            <p className={styles.notice}>
              Historique révisé ou périmètre modifié : captures conservées telles qu’enregistrées,
              variations comparables indisponibles.
            </p>
          )}
        </section>
        <AllocationTreemap categories={allocationCategories} total={total} currency={currency} />
      </div>
      <section aria-labelledby="categories-heading">
        <div className={styles.sectionHead}>
          <h2 id="categories-heading">Vos catégories</h2>
          <PeriodSelector value={categoryPeriod} onChange={setCategoryPeriod} categories />
        </div>
        {selectedCategoryPeriod === null && categoryPeriod !== '7d' && (
          <p className={styles.historyNotice} role="status">
            Pas assez de relevés sur 7 j · affichage sur 30 j.
          </p>
        )}
        {categories.length ? (
          <div className={styles.categories} role="group" aria-label="Catégories détenues">
            {categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                total={total}
                currency={currency}
                period={categoryPeriod}
                asOf={state.asOf}
                revised={state.historyRevised}
              />
            ))}
          </div>
        ) : (
          <div className={`${styles.card} ${styles.empty}`}>
            <h3>Aucune catégorie détenue</h3>
            <p>Ajoutez votre premier actif pour suivre votre patrimoine.</p>
            <Link className={styles.export} href="/assets/new">
              <Plus size={16} />
              Ajouter un actif
            </Link>
          </div>
        )}
      </section>
      <div className={styles.shortcuts}>
        <Link href="/assets/new">Ajouter un actif</Link>
        <Link href="/categories/stocks#import-bourse">Importer un CSV Bourse</Link>
        <Link href="/portfolio">Voir le portefeuille →</Link>
      </div>
    </div>
  );
}
