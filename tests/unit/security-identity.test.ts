import { expect, it } from 'vitest';
import { isinSchema, securityIsin } from '@/domain/security-identity';
import { importAccounts, matchesImportAsset, selectImportAccount } from '@/server/import-accounts';

const portfolioId = '12345678-1234-4123-a123-123456789012';
const assets = [
  {
    id: 'asset',
    platform: 'BoursoBank PEA',
    symbol: 'WPEA.PA',
    metadata: { isin: ' ie0002xzsho1\u00a0' },
    category: { key: 'SECURITIES' },
  },
];
const accounts = importAccounts(portfolioId, [], assets);

it('normalise les ISIN à toutes les frontières sans utiliser le nom du titre', () => {
  expect(isinSchema.parse(' ie0002 xzsho1\u00a0')).toBe('IE0002XZSHO1');
  expect(securityIsin(assets[0])).toBe('IE0002XZSHO1');
  expect(securityIsin({ ...assets[0], metadata: {}, externalId: 'ie0002xzsho1' })).toBe(
    'IE0002XZSHO1',
  );
  expect(matchesImportAsset(assets[0], accounts[0], { isin: 'IE0002XZSHO1' })).toBe(true);
  expect(
    matchesImportAsset(assets[0], accounts[0], { isin: 'FR0011871128', ticker: 'WPEA.PA' }),
  ).toBe(false);
});
it('sélectionne un compte stable explicitement, sans fusion de libellés proches ni de portefeuilles', () => {
  expect(selectImportAccount(portfolioId, accounts, 'Boursorama', accounts[0].id)).toEqual(
    accounts[0],
  );
  const other = selectImportAccount(portfolioId, accounts, 'BoursoBank CTO');
  expect(matchesImportAsset(assets[0], other, { isin: 'IE0002XZSHO1' })).toBe(false);
  expect(matchesImportAsset(assets[0], other, { assetId: 'asset' })).toBe(false);
  expect(selectImportAccount(portfolioId, accounts, 'boursobank pea').id).not.toBe(accounts[0].id);
  expect(importAccounts('another-portfolio', [], assets)[0].id).not.toBe(accounts[0].id);
  expect(() => selectImportAccount(portfolioId, accounts, '', other.id)).toThrow(
    /Compte introuvable/,
  );
});
it('privilégie le compte lié par ID même après un changement de libellé, sans repli sur un autre compte', () => {
  const bound = { ...assets[0], metadata: { ...assets[0].metadata, accountId: accounts[0].id } };
  expect(
    matchesImportAsset(bound, { ...accounts[0], name: 'PEA renommé' }, { isin: 'IE0002XZSHO1' }),
  ).toBe(true);
  expect(
    matchesImportAsset(bound, { id: 'different', name: bound.platform }, { isin: 'IE0002XZSHO1' }),
  ).toBe(false);
});
