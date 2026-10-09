import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseBoursoNotice } from '@/domain/bourso-notice';
import { readBoursoNotice } from '@/server/bourso-notice';

const fixture = (variant: string, extension = 'txt') =>
  readFileSync(`tests/fixtures/bourso-${variant}-anonymous.${extension}`);
const world = fixture('world').toString(),
  emerging = fixture('emerging').toString();

it.each([
  [
    'world',
    {
      isin: 'IE0002XZSHO1',
      quantity: '30',
      unit_price: '7.193',
      amount: '215.79',
      fees: '1.08',
      external_reference: '111111111',
      occurred_at: '2026-10-07T15:10:02.000Z',
    },
  ],
  [
    'emerging',
    {
      isin: 'FR0013412020',
      quantity: '6',
      unit_price: '37.35',
      amount: '224.1',
      fees: '0',
      external_reference: '222222222',
      occurred_at: '2026-10-07T15:03:18.000Z',
    },
  ],
])(
  'extrait réellement le PDF synthétique %s et retrouve les valeurs du tableau fourni',
  async (variant, expected) => {
    expect(await readBoursoNotice(fixture(variant, 'pdf').toString('base64'))).toMatchObject(
      expected,
    );
    expect(parseBoursoNotice(fixture(variant).toString())).toMatchObject(expected);
  },
);
it.each(['BUY', 'SELL'])('tableau compact %s : frais vides, nuls et non nuls', (type) => {
  for (const [cells, fees] of [
    ['224,10 EUR 0,00 EUR 224,10 EUR', '0'],
    ['224,10 EUR 0,00 EUR 0,00 EUR 224,10 EUR', '0'],
    [`224,10 EUR 1,00 EUR 0,50 EUR ${type === 'BUY' ? '225,60' : '222,60'} EUR`, '1.5'],
  ]) {
    const text = emerging
      .replace('224,10 EUR 0,00 EUR 224,10 EUR', cells)
      .replace('ACHAT', type === 'BUY' ? 'ACHAT' : 'VENTE')
      .replace('débit', type === 'BUY' ? 'débit' : 'crédit');
    expect(parseBoursoNotice(text)).toMatchObject({ type, fees, amount: '224.1' });
  }
});
it.each(['BUY', 'SELL'])('tableau détaillé %s : frais nuls, commission et courtages', (type) => {
  const text = world
    .replace('ACHAT', type === 'BUY' ? 'ACHAT' : 'VENTE')
    .replace('débit', type === 'BUY' ? 'débit' : 'crédit');
  expect(
    parseBoursoNotice(text.replace('216,87 EUR', type === 'BUY' ? '216,87 EUR' : '214,71 EUR')),
  ).toMatchObject({ type, fees: '1.08' });
  expect(
    parseBoursoNotice(text.replaceAll('1,08 EUR', '0,00 EUR').replace('216,87 EUR', '215,79 EUR'))
      .fees,
  ).toBe('0');
  expect(
    parseBoursoNotice(
      text
        .replace('215,79 EUR 0,00 EUR 0,00 EUR', '215,79 EUR 0,20 EUR 0,00 EUR')
        .replace('1,08 EUR 0,00 EUR 1,08 EUR', '1,08 EUR 0,10 EUR 1,38 EUR')
        .replace('216,87 EUR', type === 'BUY' ? '217,17 EUR' : '214,41 EUR'),
    ).fees,
  ).toBe('1.38');
});
it('refuse les incohérences avec un diagnostic financier ou de structure', () => {
  const cases: [string, RegExp][] = [
    [
      emerging.replace('224,10 EUR 0,00 EUR 224,10 EUR', '224,10 EUR 1,00 EUR 224,10 EUR'),
      /net.*incohérent/,
    ],
    [emerging.replaceAll('224,10', '225,10'), /quantité.*prix/],
    [emerging.replace('0,00 EUR', '0,00 USD'), /devises/],
    [emerging.replace('Commission Frais', 'Taxe inconnue'), /format inconnu/],
    [
      emerging.replace('224,10 EUR 0,00 EUR 224,10 EUR', '224,10 EUR 224,10 EUR'),
      /3 ou 4 montants/,
    ],
    [emerging.replace('débit', 'crédit'), /sens achat\/vente/],
    [emerging.replace('0,00 EUR', '-1,00 EUR'), /négatif/],
    [world.replace('1,08 EUR 0,00 EUR 1,08 EUR', '1,08 EUR 0,00 EUR 1,09 EUR'), /total des frais/],
    [
      world.replace('215,79 EUR 0,00 EUR 0,00 EUR', '215,79 EUR 0,00 EUR 5,00 EUR'),
      /transaction net/,
    ],
    [world.replace('215,79 EUR 0,00 EUR\n000 jours', '215,79 EUR 1,00 EUR\n000 jours'), /intérêts/],
  ];
  for (const [text, error] of cases) expect(() => parseBoursoNotice(text)).toThrow(error);
});
