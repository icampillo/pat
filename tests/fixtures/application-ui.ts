import { dashboardDailyFixture, dashboardWithPropertyAndWallet } from './dashboard';
import { realEstateAt } from '../../src/domain/real-estate';
import type { TransactionView } from '../../src/shared/types';

// Synthetic UI-only state, intercepted by Playwright. Never used by production.
export function applicationUiFixture() {
  const state = dashboardWithPropertyAndWallet();
  state.snapshots = dashboardDailyFixture().snapshots;
  state.accounts = [{ id: 'account-ui', name: 'PEA de test' }];
  state.rows[1].metadata = { pricingMode: 'SECURITIES_MARKET', ticker: 'TEST.PA', exchange: 'Paris', isin: 'FR0011871128' };
  state.rows[2].metadata = { pricingMode: 'METAL_MARKET', metalType: 'GOLD', weightGrams: '6.45', purity: '0.9' };
  for (const [key, label] of [['POKEMON', 'Pokémon'], ['ONE_PIECE', 'One Piece'], ['OTHER', 'Autres']]) {
    const category = { id: key.toLowerCase(), key, label, color: '#777777' };
    state.categories.push(category);
    state.rows.push({ ...state.rows[0], id: category.id, categoryId: category.id, category, name: label + ' test', symbol: label, price: '180', valueEur: '180', valueUsd: '198', metadata: {} });
  }
  const estate = state.rows.find(a => a.id === 'property')!;
  const property = { ...estate.metadata.realEstate!, usage: 'RENTAL' as const, rental: { monthlyRent: '1000', monthlyNonRecoverableCharges: '50', annualPropertyTax: '800', annualOwnerInsurance: '100', annualManagementFees: '0', annualOtherExpenses: '0' } };
  estate.metadata = { realEstate: property };
  estate.realEstate = realEstateAt(property, new Date(state.asOf));
  const transaction: TransactionView = {
    id: 'tx-ui', assetId: 'asset-0', assetName: 'Bitcoin', type: 'BUY', quantity: '1', unitPrice: '800',
    amount: '800', fees: '1', currency: 'EUR', platform: 'Test', destination: null, settlement: 'EXTERNAL',
    occurredAt: '2026-10-01T12:00:00.000Z', comment: '', externalReference: null, version: 1,
  };
  state.transactions = [transaction, { ...transaction, id: 'inventory-ui', assetId: 'asset-1', assetName: 'ETF Monde', type: 'ADJUSTMENT', externalReference: 'securities:ui-test', comment: 'Inventaire de test' }];
  const wallet = state.onchain.wallets[0];
  wallet.data!.source = 'ZERION';
  wallet.data!.chains = [{ id: 'eth', name: 'Ethereum', valueUsd: '1100' }];
  wallet.data!.positions = [{
    id: 'defi-ui', protocol: 'Aave', kind: 'Lending', chain: 'eth', description: 'Position de test',
    assetsUsd: '400', debtUsd: '100', netUsd: '300', observedAt: state.asOf, unlockAt: null,
    supplies: [{ ...wallet.data!.tokens[0], amount: '0.4', valueUsd: '400' }],
    borrows: [{ id: 'usdc', chain: 'eth', symbol: 'USDC', name: 'USD Coin', amount: '100', priceUsd: '1', valueUsd: '100' }],
    rewards: [],
  }];
  return { ...state, userName: 'Utilisateur test' };
}
