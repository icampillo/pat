import { decimal as d } from './money';
import type {
  AppState,
  AssetCategoryDetails,
  CategoryHistoryPoint,
  CategoryPosition,
  SnapshotView,
} from '@/shared/types';

const slugs: Record<string, string> = {
  CRYPTO: 'crypto',
  METALS: 'precious-metals',
  SECURITIES: 'stocks',
  POKEMON: 'pokemon',
  ONE_PIECE: 'one-piece',
};
export const categorySlug = (key: string) => slugs[key] ?? key.toLowerCase().replaceAll('_', '-');
export function numeric(value: unknown): number | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function calculateCategoryValue(
  values: (number | string | null | undefined)[],
): number | null {
  if (values.some((value) => numeric(value) === null)) return null;
  return Number(values.reduce<ReturnType<typeof d>>((sum, value) => sum.add(value!), d(0)));
}
export function calculateCategoryWeight(value: number | null, total: number | null) {
  return value === null || total === null || total <= 0
    ? null
    : Number(d(value).div(total).mul(100));
}
export function calculatePerformance(current: number | null, previous: number | null) {
  const absolute = current === null || previous === null ? null : Number(d(current).sub(previous));
  return {
    absolute,
    percent:
      absolute === null || previous === null || previous <= 0
        ? null
        : Number(d(absolute).div(previous).mul(100)),
  };
}
export function calculateUnrealizedPnL(value: number | null, costs: (number | null | undefined)[]) {
  const investedCapital = calculateCategoryValue(costs);
  const result = calculatePerformance(value, investedCapital);
  return { investedCapital, unrealizedPnL: result.absolute, unrealizedPnLPercent: result.percent };
}
// A current observation alone is not a historical comparison. Ties prefer the older snapshot.
export function performance30d(
  current: number | null,
  history: CategoryHistoryPoint[],
  asOf: string,
) {
  const now = Date.parse(asOf),
    target = now - 30 * 86400000;
  const baseline = history
    .filter((point) => point.value !== null && Date.parse(point.date) < now)
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.date) - target) - Math.abs(Date.parse(b.date) - target) ||
        Date.parse(a.date) - Date.parse(b.date),
    )[0];
  return {
    ...calculatePerformance(current, baseline?.value ?? null),
    baselineDate: baseline?.date ?? null,
  };
}
export function filterCategoryHistory(
  history: CategoryHistoryPoint[],
  period: string,
  asOf: string,
) {
  const days = ({ '7d': 7, '30d': 30, '90d': 90, '1y': 365 } as Record<string, number>)[period];
  return history.filter(
    (point) =>
      Date.parse(point.date) <= Date.parse(asOf) &&
      (!days || Date.parse(point.date) >= Date.parse(asOf) - days * 86400000),
  );
}

type Category = AppState['categories'][number];
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
// Read saved valuations, never reconstruct the past using today's quantities or FX rate.
export function snapshotCategoryValues(
  data: unknown,
  categories: Category[],
): NonNullable<SnapshotView['categoryValues']> {
  const snapshot = record(data);
  if (!Array.isArray(snapshot?.rows)) return {};
  const rows = snapshot.rows.map(record);
  return Object.fromEntries(
    categories.map((category) => {
      const held = rows.filter(
        (row) => row?.categoryId === category.id && (numeric(row.quantity) ?? 0) > 0,
      );
      const values = Object.fromEntries(
        ['Eur', 'Usd'].map((suffix) => {
          const amounts = held.map((row) => numeric(row?.[`value${suffix}`]));
          const chain = record(snapshot.onchain);
          if (category.key === 'CRYPTO' && chain && (numeric(chain.includedCount) ?? 0) > 0)
            amounts.push(numeric(chain[`value${suffix}`]));
          const total = calculateCategoryValue(amounts);
          return [`value${suffix}`, total === null ? null : String(total)];
        }),
      );
      return [category.id, values];
    }),
  ) as NonNullable<SnapshotView['categoryValues']>;
}

function positions(
  state: AppState,
  category: Category,
  currency: 'EUR' | 'USD',
): CategoryPosition[] {
  const assets: CategoryPosition[] = state.rows
    .filter(
      (asset) =>
        !asset.deletedAt && asset.categoryId === category.id && (numeric(asset.quantity) ?? 0) > 0,
    )
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      href: `/assets/${asset.id}`,
      quantity: asset.quantity,
      price: asset.price,
      priceCurrency: asset.currency,
      value: numeric(currency === 'EUR' ? asset.valueEur : asset.valueUsd),
      cost:
        asset.metadata.costBasis === 'UNKNOWN'
          ? null
          : numeric(currency === 'EUR' ? asset.costEur : asset.costUsd),
      change30dPercent: asset.change30dPercent ?? null,
    }));
  if (category.key !== 'CRYPTO') return assets;
  const convert = (value: string | null) => {
    if (numeric(value) === null) return null;
    if (currency === 'USD' || d(value!).isZero()) return Number(value);
    return state.fxRate && d(state.fxRate.eurUsd).gt(0)
      ? Number(d(value!).div(state.fxRate.eurUsd))
      : null;
  };
  for (const wallet of state.onchain.wallets.filter((item) => item.included)) {
    const base = { href: '/wallets', cost: null, change30dPercent: null, priceCurrency: 'USD' };
    if (!wallet.data) {
      assets.push({
        ...base,
        id: wallet.id,
        name: `${wallet.label} · valeur indisponible`,
        quantity: null,
        price: null,
        value: null,
      });
      continue;
    }
    const walletRows: CategoryPosition[] = [
      ...wallet.data.tokens
        .filter((token) => token.amount === null || !d(token.amount).isZero())
        .map((token) => ({
          ...base,
          id: `${wallet.id}:token:${token.chain}:${token.id}`,
          name: `${token.symbol} · ${wallet.label}`,
          quantity: token.amount,
          price: token.priceUsd,
          value: convert(token.valueUsd),
        })),
      ...wallet.data.positions.map((position) => ({
        ...base,
        id: `${wallet.id}:defi:${position.id}`,
        name: `${position.protocol} · ${position.kind} · ${wallet.label}`,
        quantity: null,
        price: null,
        value: convert(position.netUsd),
      })),
    ];
    // Public DeBank totals can differ from the visible detail; expose the residual, never silently lose it.
    if (walletRows.some((row) => row.value === null)) {
      assets.push({
        ...base,
        id: wallet.id,
        name: `${wallet.label} · wallet et DeFi`,
        quantity: null,
        price: null,
        value: convert(wallet.data.totalUsd),
      });
    } else {
      assets.push(...walletRows);
      const total = convert(wallet.data.totalUsd);
      const residual =
        total === null
          ? null
          : Number(d(total).sub(calculateCategoryValue(walletRows.map((row) => row.value))!));
      if (!walletRows.length || residual === null || Math.abs(residual) > 0.000001)
        assets.push({
          ...base,
          id: `${wallet.id}:other`,
          name: `${wallet.label} · solde non détaillé`,
          quantity: null,
          price: null,
          value: residual,
          isAdjustment: walletRows.length > 0,
        });
    }
  }
  return assets;
}

export function buildCategoryDetails(
  state: AppState,
  category: Category,
  currency: 'EUR' | 'USD',
): AssetCategoryDetails {
  const assets = positions(state, category, currency);
  const totalValue = calculateCategoryValue(assets.map((asset) => asset.value));
  const history = state.snapshots
    .map((snapshot) => ({
      date: snapshot.capturedAt,
      value: numeric(
        snapshot.categoryValues?.[category.id]?.[currency === 'EUR' ? 'valueEur' : 'valueUsd'],
      ),
    }))
    .filter((point) => Date.parse(point.date) <= Date.parse(state.asOf))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const performance = performance30d(totalValue, history, state.asOf);
  const currentHistory = history.filter((point) => point.date !== state.asOf);
  currentHistory.push({ date: state.asOf, value: totalValue });
  return {
    category: {
      id: category.id,
      slug: categorySlug(category.key),
      name: category.label,
      color: category.color,
      totalValue,
      assetCount: assets.filter((asset) => !asset.isAdjustment).length,
      portfolioWeight: calculateCategoryWeight(
        totalValue,
        numeric(currency === 'EUR' ? state.totals.valueEur : state.totals.valueUsd),
      ),
      change30dAbsolute: performance.absolute,
      change30dPercent: performance.percent,
      baselineDate: performance.baselineDate,
    },
    ...calculateUnrealizedPnL(
      totalValue,
      assets.map((asset) => asset.cost),
    ),
    history: currentHistory,
    assets,
  };
}
