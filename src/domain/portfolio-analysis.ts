import type {
  PortfolioAnalysisContext,
  PortfolioAnalysisPosition,
} from '@/shared/portfolio-analysis';
import type { AppState } from '@/shared/types';
import {
  buildCategoryDetails,
  calculateCategoryValue,
  calculateCategoryWeight,
  calculateUnrealizedPnL,
  numeric,
} from './categories';
import { decimal as d } from './money';
import { dietz } from './ledger';
import { canCalculatePortfolioPerformance } from './portfolio-performance';

const optionalNumber = (value: unknown) => numeric(value) ?? undefined;

function performanceAt(state: AppState, target: number) {
  // Daily captures need not fall exactly at the boundary. Report actual dates;
  // never use a distant snapshot as a fictitious 30-day/YTD baseline.
  const baseline = [...state.snapshots]
    .filter((snapshot) => {
      const at = Date.parse(snapshot.capturedAt);
      return at <= target && target - at <= 86400000;
    })
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
  const start = numeric(baseline?.totalEur);
  const end = numeric(state.totals.valueEur);
  if (!baseline || start === null || end === null) return undefined;
  const percentage = optionalNumber(
    dietz(String(start), String(end), baseline.capturedAt, state.asOf, state.flows),
  );
  return percentage === undefined
    ? undefined
    : { percentage, from: baseline.capturedAt, to: state.asOf, method: 'MODIFIED_DIETZ' as const };
}

export function buildPortfolioContext(
  state: AppState,
  currency: 'EUR' | 'USD' = state.portfolio.displayCurrency,
  generatedAt = new Date().toISOString(),
): PortfolioAnalysisContext {
  const total = numeric(currency === 'EUR' ? state.totals.valueEur : state.totals.valueUsd);
  const rows = new Map(state.rows.map((row) => [row.id, row]));
  const positions: PortfolioAnalysisPosition[] = [];
  const allocation: PortfolioAnalysisContext['portfolio']['allocationByCategory'] = [];
  const limitations = [
    'Le périmètre est celui enregistré dans Patrimoine, pas nécessairement tout le patrimoine de la personne.',
    'Concentration par ligne détenue, liquidités comprises : les expositions identiques entre comptes, tokens ou ETF ne sont pas consolidées.',
    'Les P&L sont latents sur le coût restant des positions, pas un rendement total depuis l’origine.',
    'Performances 30 jours et YTD par position omises : la date de référence du 30 jours n’est pas exposée et le YTD n’est pas calculé dans les données courantes.',
    'Performance totale depuis l’origine omise : l’historique chargé est limité à 600 captures et ne garantit pas une valorisation initiale complète.',
    'Profil investisseur, objectifs, horizon, exposition sectorielle/géographique et composition des ETF non fournis.',
  ];
  let undetailed = false;
  for (const category of state.categories) {
    const details = buildCategoryDetails(state, category, currency);
    if (!details.assets.length) continue;
    allocation.push({
      category: category.label,
      value: optionalNumber(details.category.totalValue),
      percentage: optionalNumber(calculateCategoryWeight(details.category.totalValue, total)),
    });
    for (const position of details.assets) {
      const row = rows.get(position.id);
      const wallet = row
        ? undefined
        : state.onchain.wallets.find(
            (item) => item.id === position.id || position.id.startsWith(`${item.id}:`),
          );
      const token = wallet?.data?.tokens.find(
        (item) => position.id === `${wallet.id}:token:${item.chain}:${item.id}`,
      );
      const value = numeric(position.value);
      const cost = numeric(position.cost);
      const quantity = numeric(position.quantity);
      const pnl = calculateUnrealizedPnL(value, [cost]);
      const notes: string[] = [];
      if (value === null) notes.push('Valorisation indisponible.');
      if (cost === null) notes.push('Coût d’acquisition et P&L indisponibles.');
      if (row?.stale || wallet?.stale)
        notes.push('Dernière cotation ancienne ; valeur non temps réel.');
      if (position.realEstate)
        notes.push('Valeur immobilière nette de dette, à hauteur de la quote-part détenue.');
      if (position.isAdjustment)
        notes.push('Ajustement de rapprochement du wallet, pas un actif identifié.');
      if (
        !row &&
        (position.isAdjustment || position.id.endsWith(':other') || wallet?.id === position.id)
      )
        undetailed = true;
      positions.push({
        id: position.id,
        name: position.name,
        symbol: row?.symbol || token?.symbol || undefined,
        category: category.label,
        type:
          row?.metadata.instrumentType === 'ETF'
            ? 'ETF'
            : row?.metadata.instrumentType === 'STOCK'
              ? 'Action'
              : row?.subcategory || undefined,
        quantity: position.realEstate ? undefined : (quantity ?? undefined),
        currentPrice: position.realEstate ? undefined : optionalNumber(position.price),
        priceCurrency: position.priceCurrency,
        priceDate: row?.priceDate ?? wallet?.lastSuccessAt ?? undefined,
        currentValue: value ?? undefined,
        portfolioWeight: optionalNumber(calculateCategoryWeight(value, total)),
        // Use historical reference-currency cost, not today's FX on native PRU.
        averageBuyPrice:
          cost !== null && quantity !== null && quantity > 0
            ? optionalNumber(d(cost).div(quantity).toNumber())
            : undefined,
        costBasis: cost ?? undefined,
        ...(pnl.unrealizedPnL !== null
          ? {
              pnl: {
                amount: optionalNumber(pnl.unrealizedPnL),
                percentage: optionalNumber(pnl.unrealizedPnLPercent),
              },
            }
          : {}),
        notes,
      });
    }
  }

  // Group cash by currency; account/platform names are not needed for analysis.
  const cashCurrencies = [
    ...new Set(
      state.cash.filter((cash) => numeric(cash.balance) !== 0).map((cash) => cash.currency),
    ),
  ];
  const cashPositions = cashCurrencies.map((cashCurrency) => {
    const balances = state.cash.filter((cash) => cash.currency === cashCurrency);
    const value = calculateCategoryValue(
      balances.map((cash) => (currency === 'EUR' ? cash.valueEur : cash.valueUsd)),
    );
    return {
      id: `cash:${cashCurrency}`,
      name: `Liquidités ${cashCurrency}`,
      symbol: cashCurrency,
      category: 'Liquidités',
      currentValue: optionalNumber(value),
      portfolioWeight: optionalNumber(calculateCategoryWeight(value, total)),
      notes: value === null ? ['Conversion des liquidités indisponible.'] : [],
    };
  });
  if (cashPositions.length) {
    const value = calculateCategoryValue(cashPositions.map((cash) => cash.currentValue));
    allocation.push({
      category: 'Liquidités',
      value: optionalNumber(value),
      percentage: optionalNumber(calculateCategoryWeight(value, total)),
    });
    positions.push(...cashPositions);
  }
  positions.sort(
    (a, b) =>
      (b.currentValue ?? -Infinity) - (a.currentValue ?? -Infinity) || a.name.localeCompare(b.name),
  );

  const positionTotal = calculateCategoryValue(positions.map((position) => position.currentValue));
  const reconciled =
    total !== null && positionTotal !== null && d(total).sub(positionTotal).abs().lte('0.000001');
  if (!reconciled) {
    limitations.push(
      'Valorisation incomplète ou détail non rapproché du total : poids, allocations en pourcentage et concentrations omis.',
    );
    for (const position of positions) delete position.portfolioWeight;
    for (const category of allocation) delete category.percentage;
  }
  const concentration: PortfolioAnalysisContext['portfolio']['concentration'] = {};
  if (
    reconciled &&
    total! > 0 &&
    !undetailed &&
    positions.every((position) => position.currentValue! >= 0)
  ) {
    for (const count of [1, 3, 5, 10] as const) {
      const value = calculateCategoryValue(
        positions.slice(0, count).map((position) => position.currentValue),
      );
      concentration[`top${count}Percentage`] = optionalNumber(
        calculateCategoryWeight(value, total),
      );
    }
  } else {
    limitations.push(
      'Concentrations indisponibles : total nul/incomplet, valeur nette négative ou wallet non entièrement détaillé.',
    );
  }

  const performance: NonNullable<PortfolioAnalysisContext['portfolio']['performance']> = {};
  if (reconciled && canCalculatePortfolioPerformance(state, currency)) {
    performance.d30 = performanceAt(state, Date.parse(state.asOf) - 30 * 86400000);
    const year = new Intl.DateTimeFormat('en', {
      year: 'numeric',
      timeZone: state.portfolio.timezone,
    }).format(new Date(state.asOf));
    // The two supported zones are UTC and Paris (UTC+1 on January 1st).
    performance.ytd = performanceAt(
      state,
      Date.parse(`${year}-01-01T00:00:00${state.portfolio.timezone === 'UTC' ? 'Z' : '+01:00'}`),
    );
  }
  if (!performance.d30)
    limitations.push(
      'Performance globale 30 jours indisponible : borne historique ou flux comparables insuffisants.',
    );
  if (!performance.ytd)
    limitations.push(
      'Performance globale YTD indisponible : borne historique ou flux comparables insuffisants.',
    );
  if (state.onchain.includedCount)
    limitations.push(
      'Wallets/DeFi : valeurs nettes observées, parfois arrondies ; pas de coût d’acquisition fiable, de suivi complet des flux ni d’exposition sous-jacente consolidée.',
    );
  if (state.onchain.staleCount)
    limitations.push('Certaines observations de wallets sont anciennes.');
  if (state.fxRate)
    limitations.push(
      `Conversions selon le dernier taux enregistré au ${state.fxRate.observedAt}, pas nécessairement en temps réel.`,
    );

  return {
    generatedAt,
    valuedAt: state.asOf,
    baseCurrency: currency,
    portfolio: {
      totalValue: total ?? undefined,
      ...(performance.d30 || performance.ytd ? { performance } : {}),
      allocationByCategory: allocation,
      concentration,
    },
    positions,
    limitations,
  };
}
