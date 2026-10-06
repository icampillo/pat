import type { AppState } from '@/shared/types';

// Shared with the dashboard: these perimeters lack comparable, complete flows.
export function canCalculatePortfolioPerformance(state: AppState, currency: 'EUR' | 'USD') {
  return (
    currency === 'EUR' &&
    !state.rows.some((asset) => asset.category.key === 'REAL_ESTATE') &&
    !state.totals.incompleteCostBasis &&
    !state.onchain.includedCount &&
    !state.snapshots.some((snapshot) => snapshot.kind === 'WALLET') &&
    !state.historyRevised
  );
}
