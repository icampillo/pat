'use client';
import { useState } from 'react';
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  CircleDollarSign,
  Layers3,
  Plus,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { AssetCategoryCard } from '@/components/asset-category-card';
import { AllocationChart, EvolutionChart } from '@/components/charts';
import { DashboardHeader } from '@/components/dashboard/header';
import {
  DashboardCard,
  DashboardKpi,
  PerformanceBadge,
  dashboardPrimaryAction,
} from '@/components/dashboard/primitives';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import styles from '@/components/dashboard/dashboard.module.css';
import { PortfolioAnalysisDialog } from '@/components/portfolio-analysis-dialog';
import { useWorkspace } from '@/components/workspace/context';
import { date, money } from '@/components/workspace/display';
import Link from '@/components/workspace/link';
import { buildCategoryDetails, calculateCategoryValue } from '@/domain/categories';
import { dietz } from '@/domain/ledger';
import { decimal as d } from '@/domain/money';
import { canCalculatePortfolioPerformance } from '@/domain/portfolio-performance';
import type { AppState } from '@/shared/types';

export function DashboardPage({ state }: { state: AppState }) {
  const { currency } = useWorkspace();
  const [period, setPeriod] = useState('1y');
  const [selectedAllocation, setSelectedAllocation] = useState<string | null>(null);
  const total = currency === 'EUR' ? state.totals.valueEur : state.totals.valueUsd;
  const categoryDetails = state.categories.map((item) =>
    buildCategoryDetails(state, item, currency),
  );
  const held = categoryDetails.filter((item) => item.category.assetCount > 0);
  const positionCount = held.reduce((sum, item) => sum + item.category.assetCount, 0);
  const hasRealEstate = state.rows.some((asset) => asset.category.key === 'REAL_ESTATE');
  // A portfolio-wide acquisition cost cannot be inferred for wallets or net property equity.
  const costUnavailable =
    state.totals.incompleteCostBasis || state.onchain.includedCount > 0 || hasRealEstate;
  const cost = costUnavailable
    ? null
    : currency === 'EUR'
      ? state.totals.costEur
      : state.totals.costUsd;
  const cashValue = calculateCategoryValue(
    state.cash.map((cash) => (currency === 'EUR' ? cash.valueEur : cash.valueUsd)),
  );
  const days = (
    { '24h': 1, '7d': 7, '30d': 30, '90d': 90, '180d': 180, '1y': 365, all: 10000 } as Record<
      string,
      number
    >
  )[period];
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
      href: `/categories/${category.slug}`,
    }));
  // Preserve the allocation's known-cash perimeter, without presenting a partial sum as a KPI total.
  const knownCash = state.cash.reduce(
    (sum, cash) => sum.add((currency === 'EUR' ? cash.valueEur : cash.valueUsd) || 0),
    d(0),
  );
  if (knownCash.gt(0))
    slices.push({
      name: cashValue === null ? 'Liquidités connues' : 'Liquidités',
      color: 'var(--cash)',
      value: Number(knownCash),
      href: '/portfolio',
    });
  const selectedSlice = slices.find((slice) => slice.name === selectedAllocation);
  const first = visibleSnapshots[0];
  const adjusted =
    canCalculatePortfolioPerformance(state, currency) && first?.totalEur && state.totals.valueEur
      ? dietz(first.totalEur, state.totals.valueEur, first.capturedAt, state.asOf, state.flows)
      : null;

  return (
    <div className={`${styles.root} flex min-w-0 flex-col gap-5`}>
      <DashboardHeader />
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        role="group"
        aria-label="Indicateurs du patrimoine"
      >
        <DashboardKpi
          label="Patrimoine total"
          value={money(total, currency)}
          note={total === null ? 'Valorisation incomplète' : 'Actifs et liquidités inclus'}
          icon={<Wallet size={17} />}
        />
        <DashboardKpi
          label="Capital investi"
          value={money(cost, currency)}
          note={cost === null ? 'Coût global non disponible' : 'Coût d’acquisition des positions'}
          icon={<ChartNoAxesCombined size={17} />}
        />
        <DashboardKpi
          label="Liquidités"
          value={money(cashValue, currency)}
          note={cashValue === null ? 'Conversion incomplète' : 'Soldes des comptes suivis'}
          icon={<CircleDollarSign size={17} />}
        />
        <DashboardKpi
          label="Positions suivies"
          value={String(positionCount)}
          note={`${held.length} catégorie${held.length > 1 ? 's' : ''} détenue${held.length > 1 ? 's' : ''}${state.onchain.includedCount ? ' · wallets inclus' : ''}`}
          icon={<Layers3 size={17} />}
        />
      </div>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <DashboardCard aria-labelledby="wealth-heading" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
            <h2 id="wealth-heading" className="text-sm!">
              Évolution du patrimoine
            </h2>
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>
          <div className="flex flex-col gap-2 px-5 pt-6 sm:px-6">
            <p className="text-xs font-medium text-(--muted)">
              Patrimoine total <span className="ml-1">· {currency}</span>
            </p>
            <strong
              data-testid="wealth-total"
              className="text-[clamp(1.8rem,3.5vw,3.25rem)] leading-tight tracking-[-0.045em] tabular-nums [overflow-wrap:anywhere]"
            >
              {money(total, currency)}
            </strong>
            <div className="flex min-h-7 flex-wrap items-center gap-2 text-xs text-(--muted)">
              {adjusted !== null ? (
                <>
                  <PerformanceBadge value={Number(adjusted)}>
                    {Number(adjusted) > 0 ? '+' : ''}
                    {Number(adjusted).toFixed(2)} %
                  </PerformanceBadge>
                  <span>après flux · estimé</span>
                </>
              ) : (
                <span>Performance ajustée indisponible</span>
              )}
              {first && <span>Depuis le {date(first.capturedAt)}</span>}
            </div>
            <p className="text-xs text-(--muted)">Situation au {date(state.asOf)}</p>
            {total === null && (
              <p className="text-xs text-(--warning)">
                Valorisation incomplète · certains prix ou taux de change sont indisponibles
              </p>
            )}
          </div>
          <EvolutionChart points={points} currency={currency} variant="dashboard" />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--line) px-5 py-3 text-xs sm:px-6">
            <span className="flex items-center gap-2 text-(--muted)">
              <span className="h-0.5 w-4 rounded-full bg-(--accent)" aria-hidden="true" />
              Valeur du portefeuille
            </span>
            <Link
              className="inline-flex min-h-8 items-center gap-1 font-medium text-(--accent)!"
              href="/activity?view=history"
            >
              Voir l’historique <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
          {hasRealEstate && (
            <p className="border-t border-(--line) bg-(--surface-secondary) px-5 py-3 text-xs text-(--muted) sm:px-6">
              L’évolution inclut le remboursement du capital immobilier. Le rendement global après
              flux est indisponible tant que ces flux ne sont pas suivis.
            </p>
          )}
        </DashboardCard>

        <div className="grid min-w-0 gap-5">
          <DashboardCard aria-labelledby="allocation-heading" className="overflow-hidden">
            <div className="px-5 pt-5">
              <h2 id="allocation-heading" className="text-sm!">
                Répartition
              </h2>
              <p className="mt-1! text-xs text-(--muted)">
                {total === null
                  ? 'Valorisation incomplète · valeurs connues'
                  : 'Le poids de chaque catégorie'}
              </p>
            </div>
            {slices.length ? (
              <>
                <div className="grid items-center sm:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-1">
                  <AllocationChart
                    slices={slices}
                    variant="dashboard"
                    currency={currency}
                    total={total === null ? null : Number(total)}
                    selectedName={selectedSlice?.name}
                    onSelect={setSelectedAllocation}
                  />
                  <ul className="flex flex-col gap-1 px-3 pb-3" aria-label="Poids des catégories">
                    {slices.map((slice) => (
                      <li key={slice.name}>
                        <button
                          type="button"
                          aria-pressed={selectedSlice?.name === slice.name}
                          onClick={() =>
                            setSelectedAllocation(
                              selectedSlice?.name === slice.name ? null : slice.name,
                            )
                          }
                          className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-xs transition-colors hover:bg-(--surface-secondary) aria-pressed:bg-(--accent-soft) motion-reduce:transition-none"
                        >
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: slice.color }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 text-(--muted) [overflow-wrap:anywhere]">
                            {slice.name}
                          </span>
                          <strong className="shrink-0 tabular-nums">
                            {total && d(total).gt(0)
                              ? `${d(slice.value).div(total).mul(100).toFixed(1)} %`
                              : '—'}
                          </strong>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div
                  aria-live="polite"
                  aria-atomic="true"
                  data-testid="allocation-details"
                  className="mx-4 mb-4 rounded-xl border border-(--line) bg-(--surface-secondary) p-3 text-xs"
                >
                  {selectedSlice ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <strong className="min-w-0 [overflow-wrap:anywhere]">
                          {selectedSlice.name}
                        </strong>
                        <button
                          type="button"
                          aria-label="Effacer la sélection"
                          onClick={() => setSelectedAllocation(null)}
                          className="-mr-1 grid size-8 shrink-0 place-items-center rounded-md text-(--muted) hover:bg-(--surface)"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                      <p className="mt-1! text-xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">
                        {money(selectedSlice.value, currency)}
                      </p>
                      <p className="mt-1! text-(--muted)">
                        {total && d(total).gt(0)
                          ? `${d(selectedSlice.value).div(total).mul(100).toFixed(1)} % du patrimoine`
                          : 'Poids indisponible · valorisation incomplète'}
                      </p>
                      <Link
                        href={selectedSlice.href}
                        className="mt-2 inline-flex min-h-8 items-center gap-1 font-medium text-(--accent)!"
                      >
                        Voir les positions <ArrowUpRight size={14} aria-hidden="true" />
                      </Link>
                    </>
                  ) : (
                    <p className="text-(--muted)">
                      Cliquez sur une section ou une catégorie pour voir le détail.
                    </p>
                  )}
                </div>
                <p className="border-t border-(--line) bg-(--surface-secondary) px-5 py-3 text-xs text-(--muted)">
                  Valeurs positives · liquidités incluses
                </p>
              </>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-(--muted)">
                <Layers3 size={28} aria-hidden="true" />
                <p>Votre répartition apparaîtra après un premier achat valorisé.</p>
              </div>
            )}
          </DashboardCard>
          <DashboardCard className="flex flex-col gap-3 p-4" aria-label="Analyse du portefeuille">
            <div className="flex items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--accent-soft) text-(--accent)">
                <Sparkles size={17} aria-hidden="true" />
              </span>
              <h2 className="text-sm!">Un regard éclairé</h2>
            </div>
            <p className="text-xs text-(--muted)">
              Un résumé de votre patrimoine, prêt à partager avec votre IA.
            </p>
            <PortfolioAnalysisDialog state={state} triggerClassName={dashboardPrimaryAction} />
          </DashboardCard>
        </div>
      </div>

      <section aria-labelledby="investments-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 id="investments-heading" className="text-lg!">
              Vos investissements
            </h2>
            <span className="rounded-md border border-(--line) bg-(--surface) px-2 py-0.5 text-xs text-(--muted)">
              {held.length}
            </span>
          </div>
          <Link
            className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-(--muted)! hover:text-(--accent)!"
            href="/portfolio"
          >
            Voir le portefeuille <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
        {held.length ? (
          <div
            aria-label="Catégories détenues"
            role="group"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[90rem]:grid-cols-3 min-[106.25rem]:grid-cols-4"
          >
            {held.map((item) => (
              <AssetCategoryCard
                key={item.category.id}
                category={item.category}
                currency={currency}
              />
            ))}
          </div>
        ) : (
          <DashboardCard className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="grid size-11 place-items-center rounded-xl bg-(--accent-soft) text-(--accent)">
              <Layers3 size={22} aria-hidden="true" />
            </span>
            <h3>Aucune catégorie détenue</h3>
            <p className="text-sm text-(--muted)">
              Ajoutez votre premier actif pour suivre vos investissements.
            </p>
            <Link className={dashboardPrimaryAction} href="/assets/new">
              <Plus size={16} aria-hidden="true" />
              Ajouter un actif
            </Link>
          </DashboardCard>
        )}
      </section>
    </div>
  );
}
