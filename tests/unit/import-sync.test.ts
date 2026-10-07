import { describe, expect, it } from 'vitest';
import {
  csvDate,
  normalizeCsvTransaction,
  parseTransactionCsv,
  type ImportTransaction,
} from '@/domain/transaction-csv';
import {
  matchTransactions,
  sourceReference,
  transactionFingerprint,
  type StoredTransaction,
} from '@/server/import-matching';
import { replay } from '@/domain/ledger';

const assetId = '12345678-1234-4123-a123-123456789012';
const buy = (patch: Partial<ImportTransaction> = {}): ImportTransaction => ({
  assetId,
  type: 'BUY',
  quantity: '10',
  unitPrice: '100',
  amount: '1000',
  fees: '0',
  currency: 'EUR',
  platform: 'Bourso PEA',
  occurredAt: '2025-03-01T00:00:00.000Z',
  destination: null,
  settlement: 'EXTERNAL',
  comment: '',
  externalReference: null,
  ...patch,
});
const stored = (data = buy(), id = 'legacy'): StoredTransaction => ({ ...data, id, voided: false });
const rows = (...data: ImportTransaction[]) => data.map((data, i) => ({ line: i + 2, data }));
const imported = (data: ImportTransaction[]) =>
  matchTransactions(rows(...data), [])
    .filter((r) => r.status === 'NEW')
    .map((r, i) => stored(r.data, String(i)));

describe('Normalisation CSV', () => {
  it('lit le modèle historique et les alias français avec virgules et milliers', () => {
    const parsed = parseTransactionCsv(
      'Date;Opération;ISIN;Quantité;Prix unitaire;Montant brut;Frais;Devise;Compte;Référence\n01/03/2025;Achat;FR0011871128;10;1 000,50;10 005;1,20;EUR;Bourso PEA;abc',
    );
    expect(normalizeCsvTransaction(parsed[0].fields, assetId)).toMatchObject({
      quantity: '10',
      unitPrice: '1000.5',
      amount: '10005',
      fees: '1.2',
      externalReference: 'abc',
      occurredAt: '2025-03-01T00:00:00.000Z',
    });
    expect(
      normalizeCsvTransaction({ ...parsed[0].fields, unit_price: '1,000.50' }, assetId).unitPrice,
    ).toBe('1000.5');
  });
  it('ne confond pas montant net et brut et refuse une date impossible ou sans fuseau', () => {
    expect(() => csvDate('31/02/2025')).toThrow();
    expect(() => csvDate('2025-03-01T12:00:00')).toThrow();
    expect(csvDate('2025-03-01T13:00:00+01:00')).toBe(csvDate('2025-03-01T12:00:00Z'));
    expect(() =>
      normalizeCsvTransaction(
        {
          type: 'BUY',
          quantity: '2',
          unit_price: '100',
          amount: '202',
          fees: '2',
          currency: 'EUR',
          occurred_at: '2025-01-01',
          platform: 'PEA',
        },
        assetId,
      ),
    ).toThrow('Montant incohérent');
  });
  it('conserve le montant brut arrondi par le courtier sans modifier le cours exécuté', () => {
    const data = normalizeCsvTransaction(
      {
        type: 'BUY',
        quantity: '55',
        unit_price: '6,8890',
        amount: '378,90',
        fees: '0',
        currency: 'EUR',
        occurred_at: '2026-09-15T09:58:14+02:00',
        platform: 'PEA',
      },
      assetId,
    );
    expect(data).toMatchObject({
      unitPrice: '6.889',
      amount: '378.9',
      occurredAt: '2026-09-15T07:58:14.000Z',
    });
    const ledger = replay([{ ...data, id: 'test', sequence: 1, fxToEur: '1', fxToUsd: null }]);
    expect(ledger.assets[assetId].costEur).toBe('378.9');
    expect(ledger.netFlowsEur).toBe('378.9');
  });
  it('explique la différence avec un inventaire et refuse les colonnes inconnues', () => {
    expect(() =>
      parseTransactionCsv('name;isin;quantity;buyingPrice\nETF;FR0011871128;10;100'),
    ).toThrow('positions instantanées');
    expect(() => parseTransactionCsv('type;date;montant net\nBUY;2025-01-01;100')).toThrow(
      'Colonne non reconnue',
    );
    expect(() => parseTransactionCsv('type;date;quantity;quantité\nBUY;2025-01-01;1;1')).toThrow(
      'double',
    );
  });
});
describe('Matching transactionnel', () => {
  it('100 créations, puis 100 EXISTING, puis exactement 3 créations', () => {
    const hundred = Array.from({ length: 100 }, (_, i) =>
      buy({ occurredAt: new Date(Date.UTC(2024, 0, i + 1)).toISOString() }),
    );
    const first = matchTransactions(rows(...hundred), []);
    expect(first.filter((r) => r.status === 'NEW')).toHaveLength(100);
    const history = first.map((r, i) => stored(r.data, `${i}`));
    expect(matchTransactions(rows(...hundred), history).every((r) => r.status === 'EXISTING')).toBe(
      true,
    );
    const next = [
      buy({ occurredAt: '2025-01-01T00:00:00.000Z' }),
      buy({ occurredAt: '2025-01-02T00:00:00.000Z' }),
      buy({ occurredAt: '2025-01-03T00:00:00.000Z' }),
    ];
    const third = matchTransactions(rows(...hundred, ...next), history);
    expect(third.filter((r) => r.status === 'NEW')).toHaveLength(3);
    expect(third.filter((r) => r.status === 'EXISTING')).toHaveLength(100);
    expect(
      matchTransactions(rows(...[...hundred, ...next].reverse()), history).filter(
        (r) => r.status === 'NEW',
      ),
    ).toHaveLength(3);
  });
  it('conserve la première transaction et renforce 10 + 5 = 15, coût 1600', () => {
    const original = stored();
    const next = buy({
      quantity: '5',
      unitPrice: '120',
      amount: '600',
      occurredAt: '2025-10-07T00:00:00.000Z',
    });
    const match = matchTransactions(rows(buy(), next), [original]);
    expect(match.map((r) => r.status)).toEqual(['EXISTING', 'NEW']);
    const ledger = [original, match[1].data].map((t, i) => ({
      ...t,
      id: `${i}`,
      sequence: i,
      fxToEur: '1',
      fxToUsd: null,
    }));
    expect(replay(ledger).assets[assetId].quantity.toString()).toBe('15');
    expect(replay(ledger).assets[assetId].costEur.toString()).toBe('1600');
    expect(original).toEqual(stored());
  });
  it('gère plusieurs achats identiques le même jour sans dépendre de l’ordre', () => {
    const small = buy({ quantity: '5', amount: '500' });
    const history = imported([buy(), buy(), small]);
    expect(history).toHaveLength(3);
    expect(new Set(history.map((t) => t.externalReference)).size).toBe(3);
    expect(matchTransactions(rows(small, buy(), buy()), history).map((r) => r.status)).toEqual([
      'EXISTING',
      'EXISTING',
      'EXISTING',
    ]);
    expect(
      matchTransactions(rows(buy(), small, buy(), buy()), history).filter(
        (r) => r.status === 'NEW',
      ),
    ).toHaveLength(1);
  });
  it('privilégie l’ID broker et conserve deux opérations ayant des IDs distincts', () => {
    const first = buy({ externalReference: 'a' }),
      second = buy({ externalReference: 'b' });
    expect(matchTransactions(rows(second), [stored(first)])[0].status).toBe('NEW');
    const changed = matchTransactions(rows({ ...first, fees: '2' }), [stored(first)])[0];
    expect(changed.status).toBe('CHANGED');
    expect(changed.candidates[0].differences).toContainEqual({
      field: 'fees',
      before: '0',
      after: '2',
    });
    expect(changed.canCreate).toBe(false);
    expect(sourceReference('BOURSORAMA', 'PEA', '123')).not.toBe(
      sourceReference('BOURSORAMA', 'CTO', '123'),
    );
  });
  it('match les anciennes transactions sans empreinte sans les enrichir ni les modifier', () => {
    const history = [
      stored(),
      stored(
        buy({ occurredAt: '2025-04-01T00:00:00.000Z', externalReference: 'ancienne-reference' }),
        'second',
      ),
    ];
    const before = structuredClone(history);
    expect(
      matchTransactions(
        rows(buy(), buy({ occurredAt: '2025-04-01T00:00:00.000Z' })),
        history,
      ).every((r) => r.status === 'EXISTING'),
    ).toBe(true);
    expect(history).toEqual(before);
    expect(
      matchTransactions(rows(buy({ externalReference: 'broker-new-id' })), [stored()])[0].status,
    ).toBe('EXISTING');
  });
  it('ne recrée pas les opérations annulées ni celles déjà couvertes par un inventaire', () => {
    expect(matchTransactions(rows(buy()), [{ ...stored(), voided: true }])[0]).toMatchObject({
      status: 'AMBIGUOUS',
      canCreate: false,
    });
    expect(
      matchTransactions(rows(buy()), [
        stored(buy({ type: 'ADJUSTMENT', occurredAt: '2025-04-01T00:00:00.000Z' })),
      ])[0],
    ).toMatchObject({ status: 'AMBIGUOUS', canCreate: true });
    expect(
      matchTransactions(rows(buy({ occurredAt: '2025-05-01T00:00:00.000Z' })), [
        stored(buy({ type: 'ADJUSTMENT', occurredAt: '2025-04-01T00:00:00.000Z' })),
      ])[0].status,
    ).toBe('NEW');
  });
  it('normalise les zéros décimaux sans effacer les différences d’arrondi réelles', () => {
    expect(transactionFingerprint(buy())).toBe(
      transactionFingerprint(buy({ quantity: '10.000', unitPrice: '100.0' })),
    );
    expect(
      matchTransactions(rows(buy({ unitPrice: '100.000000001', amount: '1000.00000001' })), [
        stored(),
      ])[0].status,
    ).toBe('CHANGED');
  });
  it('ne matche pas un autre compte ou un autre actif et signale les voisins ambigus', () => {
    expect(matchTransactions(rows(buy({ platform: 'CTO' })), [stored()])[0].status).toBe('NEW');
    expect(matchTransactions(rows(buy({ assetId: 'another' })), [stored()])[0].status).toBe('NEW');
    expect(
      matchTransactions(rows(buy({ quantity: '8', amount: '800' })), [
        stored(),
        stored(buy({ quantity: '9', amount: '900' }), 'second'),
      ])[0].status,
    ).toBe('AMBIGUOUS');
  });
  it('ignore les répétitions du même ID mais bloque les IDs contradictoires', () => {
    const row = buy({ externalReference: 'a' });
    expect(matchTransactions(rows(row, row), []).map((r) => r.status)).toEqual(['NEW', 'EXISTING']);
    expect(matchTransactions(rows(row, { ...row, fees: '2' }), []).map((r) => r.status)).toEqual([
      'AMBIGUOUS',
      'AMBIGUOUS',
    ]);
  });
});
