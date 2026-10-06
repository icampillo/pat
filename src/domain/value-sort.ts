import { decimal as d, type MoneyInput } from './money';

// Sort presentation copies only: shared state and chronological calculations stay untouched.
export function sortByValue<T>(rows: readonly T[], value: (row: T) => MoneyInput | null): T[] {
  return rows
    .map((row) => ({ row, value: value(row) }))
    .sort((a, b) => {
      if (a.value === null) return b.value === null ? 0 : 1;
      if (b.value === null) return -1;
      return d(b.value).cmp(a.value);
    })
    .map(({ row }) => row);
}

export function valueInEur(amount: MoneyInput | null, currency: string, eurUsd: string | null) {
  if (amount === null) return null;
  if (currency === 'EUR' || d(amount).isZero()) return amount;
  return currency === 'USD' && eurUsd && d(eurUsd).gt(0) ? d(amount).div(eurUsd) : null;
}
