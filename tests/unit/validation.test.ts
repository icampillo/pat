import { it, expect } from 'vitest';
import { assetSchema, transactionSchema, decimalSchema } from '../../src/shared/schemas';
import { withFallback, UnconfiguredProvider } from '../../src/modules/prices/providers';
import { safeCsv } from '../../src/server/exports';
it('rejette les montants non finis, exponentiels et ambigus', () => {
  for (const value of ['NaN', 'Infinity', '1e10', '1,200', '1.0000000000000000001'])
    expect(decimalSchema.safeParse(value).success).toBe(false);
});
it('rejette une pureté hors limites et les champs inconnus', () => {
  expect(
    assetSchema.safeParse({
      name: 'Or',
      symbol: 'AU',
      categoryId: crypto.randomUUID(),
      currency: 'EUR',
      platform: 'Coffre',
      metadata: { purity: '1.1' },
    }).success,
  ).toBe(false);
});
it('rejette une transaction sans actif obligatoire', () =>
  expect(
    transactionSchema.safeParse({
      type: 'BUY',
      assetId: null,
      quantity: '1',
      unitPrice: '1',
      currency: 'EUR',
      platform: 'A',
      occurredAt: '2025-01-01T00:00:00Z',
    }).success,
  ).toBe(false));
it('conserve la date du dernier prix lors d’une panne', async () => {
  const old = {
    price: '10',
    currency: 'EUR',
    source: 'manual',
    observedAt: new Date('2025-01-01'),
    fetchedAt: new Date('2025-01-01'),
  };
  const codes: string[] = [];
  const result = await withFallback(
    new UnconfiguredProvider('crypto'),
    { id: 'a', symbol: 'BTC', currency: 'EUR', category: 'CRYPTO' },
    old,
    (c) => codes.push(c),
  );
  expect(result.quote).toBe(old);
  expect(result.stale).toBe(true);
  expect(codes).toEqual(['PRICE_PROVIDER_FAILED']);
});
it('n’utilise pas de prix fictif ou dans une mauvaise devise', async () => {
  const result = await withFallback(
    new UnconfiguredProvider('cards'),
    { id: 'a', symbol: 'X', currency: 'EUR', category: 'POKEMON' },
    null,
    () => {},
  );
  expect(result.quote).toBeNull();
});
it('neutralise les formules CSV en conservant les décimaux', () => {
  const csv = safeCsv([
    { name: '=HYPERLINK("x")', quantity: '0.123456789123456789', gain: '-12.50' },
  ]);
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).toContain('0.123456789123456789');
  expect(csv).toContain('"-12.50"');
});
