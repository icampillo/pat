import { numeric } from './categories';
import { snapshotCashValues } from './dashboard';
import { decimal as d } from './money';
import type { AppState, SnapshotView } from '@/shared/types';

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
type Values = { valueEur: string | null; valueUsd: string | null };
export type SnapshotSummary = {
  version: 1;
  groups: ({ id: string; key: string } & Values)[] | null;
  chain: Values | null;
  cashValues?: Values;
};
// Preserve the original reader's numeric conversion, null propagation and final rounding.
// Intermediate sums stay decimal strings, so combining legacy categories does not round twice.
export function summarizeSnapshot(data: unknown): SnapshotSummary {
  const saved = record(data);
  const hasRows = Array.isArray(saved?.rows);
  const sums = new Map<string, { id: string; key: string } & Values>();
  if (hasRows)
    for (const value of saved!.rows as unknown[]) {
      const row = record(value);
      if ((numeric(row?.quantity) ?? 0) <= 0) continue;
      const id = String(row?.categoryId ?? '');
      const key = String(record(row?.category)?.key ?? '');
      const groupKey = JSON.stringify([id, key]);
      const group = sums.get(groupKey) ?? { id, key, valueEur: '0', valueUsd: '0' };
      for (const field of ['valueEur', 'valueUsd'] as const) {
        const amount = numeric(row?.[field]);
        group[field] =
          group[field] === null || amount === null ? null : d(group[field]).add(amount).toFixed();
      }
      sums.set(groupKey, group);
    }
  const chain = record(saved?.onchain);
  const values = (value: Record<string, unknown>): Values =>
    Object.fromEntries(
      ['valueEur', 'valueUsd'].map((field) => {
        const amount = numeric(value[field]);
        return [field, amount === null ? null : String(amount)];
      }),
    ) as Values;
  return {
    version: 1,
    groups: hasRows ? [...sums.values()] : null,
    chain: chain && (numeric(chain.includedCount) ?? 0) > 0 ? values(chain) : null,
    cashValues: snapshotCashValues(data),
  };
}
export function summaryCategoryValues(
  summary: SnapshotSummary,
  categories: AppState['categories'],
) {
  if (!summary.groups) return {};
  return Object.fromEntries(
    categories.map((category) => {
      const amounts: Values[] = summary.groups!.filter(
        (group) =>
          group.id === category.id ||
          (category.key === 'OTHER' && ['POKEMON', 'ONE_PIECE'].includes(group.key)),
      );
      if (category.key === 'CRYPTO' && summary.chain) amounts.push(summary.chain);
      return [
        category.id,
        Object.fromEntries(
          ['valueEur', 'valueUsd'].map((field) => {
            const key = field as keyof Values;
            const total = amounts.some((value) => value[key] === null)
              ? null
              : Number(amounts.reduce((sum, value) => sum.add(value[key]!), d(0)));
            return [field, total === null ? null : String(total)];
          }),
        ),
      ];
    }),
  ) as NonNullable<SnapshotView['categoryValues']>;
}
