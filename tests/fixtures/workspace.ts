import type { AppState } from '../../src/shared/types';

export function workspaceFixture(): AppState & { userName: string } {
  const category = { id: 'crypto-id', key: 'CRYPTO', label: 'Cryptomonnaies', color: '#6556dc' };
  return {
    userName: 'Utilisateur test',
    asOf: new Date().toISOString(),
    historyRevised: false,
    portfolio: {
      id: 'test-portfolio',
      name: 'Portefeuille test',
      displayCurrency: 'EUR',
      timezone: 'Europe/Paris',
      isDemo: false,
      version: 1,
    },
    categories: [category],
    rows: [
      {
        id: 'test-asset',
        name: 'Bitcoin test',
        symbol: 'BTC',
        categoryId: category.id,
        category,
        currency: 'EUR',
        platform: 'Test',
        subcategory: null,
        externalId: null,
        notes: '',
        status: 'ACTIVE',
        metadata: {},
        version: 1,
        deletedAt: null,
        quantity: '1',
        costEur: '800',
        costUsd: '880',
        averagePrice: '800',
        price: '1000',
        priceDate: new Date().toISOString(),
        stale: false,
        valueEur: '1000',
        valueUsd: '1100',
        gainEur: '200',
        gainUsd: '220',
        realizedEur: '0',
        places: {},
        image: null,
      },
    ],
    transactions: [],
    snapshots: [],
    cash: [],
    flows: [],
    totals: {
      valueEur: '1000',
      valueUsd: '1100',
      subtotalEur: '1000',
      costEur: '800',
      costUsd: '880',
      realizedEur: '0',
      incompleteCostBasis: false,
      unrealizedEur: '200',
      netFlowsEur: '800',
      purchasesEur: '800',
      incomeEur: '0',
      expensesEur: '0',
      missingEur: 0,
      missingUsd: 0,
    },
    fxRate: { eurUsd: '1.1', observedAt: new Date().toISOString(), source: 'manual' },
    onchain: {
      wallets: [],
      config: {
        enabled: false,
        configured: true,
        mode: 'API',
        hasKey: false,
        intervalMinutes: 1440,
      },
      includedCount: 0,
      missing: 0,
      staleCount: 0,
      valueEur: '0',
      valueUsd: '0',
    },
  };
}

// Match real scoped contracts: missing fields must not be hidden by a full-state mock.
export function scopedWorkspaceFixture(state: AppState & { userName?: string }, url: string) {
  const scope = new URL(url).searchParams.get('scope');
  const { portfolio, asOf, fxRate, userName, onchain } = state;
  if (scope === 'wallets') return { portfolio, asOf, fxRate, userName, onchain };
  if (scope === 'settings')
    return {
      portfolio,
      asOf,
      fxRate,
      userName,
      accounts: state.accounts ?? [],
      onchain: {
        config: onchain.config,
        wallets: onchain.wallets.map(
          ({ id, enabled, status, errorCode, lastSuccessAt, nextSyncAt }) => ({
            id,
            enabled,
            status,
            errorCode,
            lastSuccessAt,
            nextSyncAt,
          }),
        ),
      },
    };
  if (scope === 'live') {
    const result: Partial<typeof state> = { ...state };
    delete result.snapshots;
    return result;
  }
  return state;
}
