import type { AppState } from '@/shared/types';

// Flow-adjusted returns only: these perimeters lack comparable, complete flows.
// Simple changes in saved value remain meaningful and do not use this guard.
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
