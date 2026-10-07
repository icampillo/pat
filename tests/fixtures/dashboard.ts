import type { AppState } from '../../src/shared/types';
import { realEstateAt } from '../../src/domain/real-estate';
import { workspaceFixture } from './workspace';
import { property, loan } from './real-estate';

// Synthetic, deterministic browser data only; never persisted or used by the application.
export function dashboardFixture(): AppState {
  const state = workspaceFixture();
  state.asOf = '2026-10-07T12:00:00.000Z';
  state.portfolio.name = 'Mon patrimoine';
  state.categories = [
    { id: 'crypto', key: 'CRYPTO', label: 'Cryptomonnaies', color: '#7660d3' },
    { id: 'stocks', key: 'SECURITIES', label: 'Bourse', color: '#246bfd' },
    { id: 'metals', key: 'METALS', label: 'Métaux précieux', color: '#c68a28' },
  ];
  const values = [28640.5, 68410.24, 14900];
  state.rows = values.map((value, index) => ({
    ...state.rows[0],
    id: `asset-${index}`,
    name: ['Bitcoin', 'ETF Monde', 'Or'][index],
    symbol: ['BTC', 'ETF', 'XAU'][index],
    categoryId: state.categories[index].id,
    category: state.categories[index],
    valueEur: String(value),
    valueUsd: String(value * 1.1),
    costEur: '30000',
    costUsd: '33000',
    price: String(value),
    priceDate: state.asOf,
  }));
  state.cash = [
    { currency: 'EUR', platform: 'Compte', balance: '16500', valueEur: '16500', valueUsd: '18150' },
  ];
  Object.assign(state.totals, {
    valueEur: '128450.74',
    valueUsd: '141295.814',
    costEur: '90000',
    costUsd: '99000',
  });
  state.snapshots = [
    95000, 98100, 97200, 103200, 99700, 105800, 114000, 109000, 113400, 113900, 118000, 114300,
    119600, 125000, 122500, 126300, 128450.74,
  ].map((value, index, all) => {
    const progress = index / (all.length - 1);
    return {
      id: `snapshot-${index}`,
      capturedAt: new Date(
        Date.parse(state.asOf) - (all.length - 1 - index) * 7 * 86400000,
      ).toISOString(),
      kind: 'MANUAL',
      totalEur: String(value),
      totalUsd: String(value * 1.1),
      investedEur: '90000',
      ledgerVersion: 1,
      categoryValues: Object.fromEntries(
        state.categories.map((category, i) => [
          category.id,
          {
            valueEur: String(values[i] * (i === 2 ? 1.1 - 0.1 * progress : 0.7 + 0.3 * progress)),
            valueUsd: String(
              values[i] * 1.1 * (i === 2 ? 1.1 - 0.1 * progress : 0.7 + 0.3 * progress),
            ),
          },
        ]),
      ),
    };
  });
  return state;
}

export function dashboardWithPropertyAndWallet(): AppState {
  const state = dashboardFixture();
  const category = { id: 'estate', key: 'REAL_ESTATE', label: 'Immobilier', color: '#239780' };
  state.categories.push(category);
  const metadata = {
    ...property,
    mortgage: { ...loan, borrowedAmount: '180000', startDate: '2026-10-07' },
  };
  const valuation = realEstateAt(metadata, new Date(state.asOf));
  state.rows.push({
    ...state.rows[0],
    id: 'property',
    name: 'Appartement',
    symbol: 'IMMO',
    categoryId: category.id,
    category,
    metadata: { realEstate: metadata },
    realEstate: valuation,
    valueEur: valuation.equity,
    valueUsd: '132000',
    costEur: null,
    costUsd: null,
  });
  state.onchain.includedCount = 1;
  state.onchain.valueEur = '1000';
  state.onchain.valueUsd = '1100';
  state.onchain.wallets = [
    {
      id: 'wallet',
      address: `0x${'a'.repeat(40)}`,
      label: 'Wallet test',
      referenceUsd: null,
      referenceAt: null,
      enabled: false,
      included: true,
      status: 'OK',
      errorCode: null,
      lastSuccessAt: state.asOf,
      nextSyncAt: state.asOf,
      stale: false,
      data: {
        totalUsd: '1100',
        liquidUsd: '1100',
        defiUsd: '0',
        debtUsd: '0',
        rewardsUsd: '0',
        reconciliationUsd: '0',
        chains: [],
        positions: [],
        tokens: [
          {
            id: 'eth',
            chain: 'eth',
            symbol: 'ETH',
            name: 'Ethereum',
            amount: '1',
            priceUsd: '1100',
            valueUsd: '1100',
          },
        ],
      },
    },
  ];
  Object.assign(state.totals, {
    valueEur: '249450.74',
    valueUsd: '274395.814',
    costEur: null,
    costUsd: null,
  });
  return state;
}
