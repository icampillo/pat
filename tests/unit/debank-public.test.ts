import { describe, it, expect } from 'vitest';
import {
  normalizePublicDocument,
  publicNumber,
  type PublicDocument,
} from '../../src/server/debank-public';
import { address } from '../fixtures/debank';
const cell = (text: string) => ({ text, tokens: [] });
const balance = (amount: string, symbol: string, chain = 'eth') => ({
  text: `${amount} ${symbol}`,
  tokens: [{ href: `/token/${chain}/${symbol}`, symbol, amount, value: '' }],
});
export const publicFixture: PublicDocument = {
  addressText: address,
  total: '$905',
  walletTotal: '$200',
  updated: 'Data updated 1 min ago',
  chains: [],
  tokens: [[balance('', 'USDC'), cell('$1.0000'), cell('200.0000'), cell('$200.00')]],
  projects: [
    {
      id: 'sample',
      name: 'Public fixture protocol',
      total: '$705',
      panels: [
        {
          kind: 'Lending',
          tables: [
            {
              headers: ['Supplied', 'Balance', 'USD Value'],
              rows: [[balance('', 'ETH'), balance('1.5', 'ETH'), cell('$900.00')]],
            },
            {
              headers: ['Borrowed', 'Balance', 'USD Value'],
              rows: [[balance('', 'USDC'), balance('200', 'USDC'), cell('$200.00')]],
            },
            {
              headers: ['Rewards', 'Balance', 'USD Value'],
              rows: [[balance('', 'RWD'), balance('5', 'RWD'), cell('$5.00')]],
            },
          ],
        },
      ],
    },
  ],
};
describe('Lecture gratuite de la page DeBank', () => {
  it.each([
    ['$28,446', '28446'],
    ['$0.0₅2227', '0.000002227'],
    ['0.0₁₇1', '0.000000000000000001'],
    ['1,074.8863', '1074.8863'],
    ['<$0.01', null],
    ['Loading', null],
    ['2.4M', null],
    ['$0.00', '0'],
  ])('interprète %s sans inventer de précision', (raw, expected) => {
    expect(publicNumber(raw!)).toBe(expected);
  });
  it('sépare les soldes, les emprunts et les récompenses et conserve le total public', () => {
    const result = normalizePublicDocument(publicFixture, address);
    expect(result).toMatchObject({
      source: 'DEBANK_PUBLIC',
      rounded: true,
      totalUsd: '905',
      liquidUsd: '200',
      defiUsd: '705',
      debtUsd: '200',
      rewardsUsd: '5',
      reconciliationUsd: '0',
    });
    expect(result.positions[0].supplies[0].amount).toBe('1.5');
    expect(result.positions[0].borrows[0].amount).toBe('200');
  });
  it('refuse la valeur transitoire et un profil différent', () => {
    expect(() => normalizePublicDocument({ ...publicFixture, updated: '' }, address)).toThrow(
      'FORMAT',
    );
    expect(() =>
      normalizePublicDocument({ ...publicFixture, total: 'Updating data' }, address),
    ).toThrow('FORMAT');
    expect(() => normalizePublicDocument(publicFixture, `0x${'b'.repeat(40)}`)).toThrow('FORMAT');
  });
  it('garde les montants inférieurs à un centime comme bornes', () => {
    const fixture = structuredClone(publicFixture);
    fixture.tokens[0][3].text = '<$0.01';
    const token = normalizePublicDocument(fixture, address).tokens[0];
    expect(token.valueUsd).toBeNull();
    expect(token.valueText).toBe('<$0.01');
  });
  it('signale un protocole inconnu au lieu de le perdre silencieusement', () => {
    const fixture = structuredClone(publicFixture);
    fixture.projects[0].panels = [];
    const value = normalizePublicDocument(fixture, address);
    expect(value.positions[0].netUsd).toBe('705');
    expect(value.warnings).toHaveLength(1);
  });
});
