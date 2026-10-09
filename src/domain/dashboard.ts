import {
  calculateCategoryValue,
  calculatePerformance,
  filterCategoryHistory,
  numeric,
} from './categories';
import type { CategoryHistoryPoint } from '@/shared/types';
import { snapshotDay } from './snapshot-day';

// Prefer seven days, but do not hide saved history behind an empty initial window.
// Only the chart's initial selection changes; seven-day value comparisons are independent.
export function availableChartPeriod(
  histories: CategoryHistoryPoint[][],
  asOf: string,
  periods: string[],
) {
  return (
    periods.find((period) =>
      histories.some(
        (history) =>
          filterCategoryHistory(history, period, asOf).filter((point) => point.value !== null)
            .length >= 2,
      ),
    ) ?? periods[0]
  );
}

// Exact elapsed time: never relabel the nearest (or first) observation as seven days.
export function valueChange7d(
  current: number | null,
  history: CategoryHistoryPoint[],
  asOf: string,
  revised = false,
) {
  const today = snapshotDay(asOf);

  const target = new Date(`${today}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - 7);

  const targetDay = target.toISOString().slice(0, 10);

  const baseline = history.find(
    (point) => snapshotDay(point.date) === targetDay,
  );

  const reason = revised
    ? 'Historique révisé ou périmètre modifié : comparaison fiable indisponible.'
    : current === null
      ? 'Valorisation actuelle incomplète.'
      : !baseline || baseline.value === null
        ? 'Aucune valorisation complète disponible 7 jours auparavant.'
        : baseline.value <= 0
          ? 'Pourcentage indéfinissable : valeur de référence nulle ou négative.'
          : null;

  return {
    percent: reason
      ? null
      : calculatePerformance(current, baseline!.value).percent,
    reason,
    baselineDate: baseline?.date ?? null,
  };
}

// Read cash actually saved in the snapshot, including its historical FX conversion.
export function snapshotCashValues(data: unknown) {
  if (!data || typeof data !== 'object' || !('cash' in data) || !Array.isArray(data.cash))
    return undefined;
  const cash = data.cash;
  const sum = (key: 'valueEur' | 'valueUsd') => {
    const total = calculateCategoryValue(
      cash.map((row: unknown) =>
        row && typeof row === 'object' && key in row
          ? numeric((row as Record<string, unknown>)[key])
          : null,
      ),
    );
    return total === null ? null : String(total);
  };
  return { valueEur: sum('valueEur'), valueUsd: sum('valueUsd') };
}

// Binary treemap; every rectangle occupies its exact share of the positive sum.
export function allocationRects(
  items: { id: string; value: number }[],
  x = 0,
  y = 0,
  width = 100,
  height = 100,
): { id: string; x: number; y: number; width: number; height: number }[] {
  const positive = items.filter((item) => Number.isFinite(item.value) && item.value > 0);
  if (!positive.length) return [];
  if (positive.length === 1) return [{ id: positive[0].id, x, y, width, height }];
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  let split = 1,
    sum = positive[0].value;
  while (
    split < positive.length - 1 &&
    Math.abs(sum + positive[split].value - total / 2) < Math.abs(sum - total / 2)
  )
    sum += positive[split++].value;
  const ratio = sum / total;
  return width >= height
    ? [
        ...allocationRects(positive.slice(0, split), x, y, width * ratio, height),
        ...allocationRects(
          positive.slice(split),
          x + width * ratio,
          y,
          width * (1 - ratio),
          height,
        ),
      ]
    : [
        ...allocationRects(positive.slice(0, split), x, y, width, height * ratio),
        ...allocationRects(
          positive.slice(split),
          x,
          y + height * ratio,
          width,
          height * (1 - ratio),
        ),
      ];
}
