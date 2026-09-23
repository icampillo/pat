import { describe, it, expect } from 'vitest';
import { replay, dietz, type LedgerTransaction } from '../../src/domain/ledger';
import { metalValue } from '../../src/domain/money';
const base: LedgerTransaction = {
  id: 'one',
  assetId: 'asset',
  type: 'BUY',
  quantity: '2',
  unitPrice: '100',
  fees: '2',
  amount: '0',
  currency: 'EUR',
  fxToEur: '1',
  fxToUsd: '1.1',
  platform: 'A',
  destination: null,
  settlement: 'EXTERNAL',
  occurredAt: '2025-01-01T00:00:00.000Z',
  sequence: 1,
};
const tx = (values: Partial<LedgerTransaction>) => ({ ...base, ...values });
describe('Coût moyen et mouvements', () => {
  const sequence = [
    base,
    tx({ id: 'two', quantity: '1', unitPrice: '130', fees: '1', sequence: 2 }),
    tx({
      id: 'three',
      type: 'SELL',
      quantity: '1',
      unitPrice: '150',
      fees: '3',
      settlement: 'INTERNAL',
      sequence: 3,
    }),
  ];
  it('reproduit les coûts, PMA, gains réalisés et cash de référence', () => {
    const result = replay(sequence);
    expect(result.assets.asset).toMatchObject({
      quantity: '2',
      costEur: '222',
      averageEur: '111',
      realizedEur: '36',
    });
    expect(result.cash[0].balance).toBe('147');
    expect(result.netFlowsEur).toBe('333');
  });
  it('clôture sans résidu et comptabilise les frais une fois', () => {
    const result = replay([
      ...sequence,
      tx({
        id: 'four',
        type: 'SELL',
        quantity: '2',
        unitPrice: '140',
        fees: '2',
        settlement: 'INTERNAL',
        sequence: 4,
      }),
    ]);
    expect(result.assets.asset.costEur).toBe('0');
    expect(result.assets.asset.realizedEur).toBe('92');
    expect(result.cash[0].balance).toBe('425');
  });
  it('additionne exactement les quantités décimales', () =>
    expect(
      replay([tx({ quantity: '0.1', fees: '0' }), tx({ quantity: '0.2', fees: '0', sequence: 2 })])
        .assets.asset.quantity,
    ).toBe('0.3'));
  it('refuse une vente dépassant le solde', () =>
    expect(() => replay([base, tx({ type: 'SELL', quantity: '3', sequence: 2 })])).toThrow(
      'insuffisante',
    ));
  it('conserve quantité et coût dans un transfert', () => {
    const a = replay([
      base,
      tx({ type: 'TRANSFER', quantity: '0.5', fees: '0', destination: 'B', sequence: 2 }),
    ]).assets.asset;
    expect(a.quantity).toBe('2');
    expect(a.costEur).toBe('202');
    expect(a.places).toEqual({ A: '1.5', B: '0.5' });
  });
  it('rejette une vente sur la mauvaise plateforme', () =>
    expect(() =>
      replay([base, tx({ type: 'SELL', quantity: '1', platform: 'B', sequence: 2 })]),
    ).toThrow('insuffisante'));
  it('inclut les dividendes dans le cash mais pas dans les apports', () => {
    const r = replay([
      base,
      tx({ type: 'DIVIDEND', quantity: '0', amount: '10', fees: '0', sequence: 2 }),
    ]);
    expect(r.incomeEur).toBe('10');
    expect(r.cash[0].balance).toBe('10');
    expect(r.netFlowsEur).toBe('202');
  });
  it('traite une récompense comme revenu en nature', () => {
    const r = replay([tx({ type: 'REWARD', quantity: '0.1', unitPrice: '100', fees: '0' })]);
    expect(r.assets.asset.costEur).toBe('10');
    expect(r.incomeEur).toBe('10');
    expect(r.netFlowsEur).toBe('0');
    expect(r.cash).toEqual([]);
  });
  it('applique le change de chaque acquisition et vente', () => {
    const r = replay([
      tx({
        quantity: '1',
        unitPrice: '100',
        fees: '0',
        currency: 'USD',
        fxToEur: '0.9',
        fxToUsd: '1',
      }),
      tx({
        type: 'SELL',
        quantity: '1',
        unitPrice: '120',
        fees: '0',
        currency: 'USD',
        fxToEur: '0.95',
        fxToUsd: '1',
        sequence: 2,
      }),
    ]);
    expect(r.assets.asset.realizedEur).toBe('24');
    expect(r.assets.asset.realizedUsd).toBe('20');
  });
  it('refuse le financement interne sans liquidités', () =>
    expect(() => replay([tx({ settlement: 'INTERNAL' })])).toThrow('Liquidités'));
  it('un dépôt finance un achat interne sans nouveau flux', () => {
    const r = replay([
      tx({ assetId: null, type: 'DEPOSIT', amount: '300', quantity: '0', fees: '0' }),
      tx({ settlement: 'INTERNAL', sequence: 2 }),
    ]);
    expect(r.cash[0].balance).toBe('98');
    expect(r.netFlowsEur).toBe('300');
  });
});
describe('Valorisation et performance', () => {
  it('calcule le poids fin et la prime', () =>
    expect(metalValue('6.45', '0.9', '80', '10')).toBe('474.4'));
  it('neutralise les apports dans le rendement', () =>
    expect(
      dietz('1000', '1500', '2025-01-01', '2025-01-11', [{ date: '2025-01-06', amount: '500' }]),
    ).toBe('0'));
  it('calcule Dietz à 8 % dans le cas de référence', () =>
    expect(
      dietz('1000', '1600', '2025-01-01', '2025-01-11', [{ date: '2025-01-06', amount: '500' }]),
    ).toBe('8'));
  it('n’invente pas de rendement sur une base nulle', () =>
    expect(dietz('0', '0', '2025-01-01', '2025-01-11', [])).toBeNull());
});
