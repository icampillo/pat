import { expect, it } from 'vitest';
import { parseBoursoNotice } from '@/domain/bourso-notice';
import { normalizeCsvTransaction } from '@/domain/transaction-csv';

// Présentation de l’avis fourni, sans identité, adresse, compte ni référence personnelle.
const notice = `BoursoBank ACHAT COMPTANT ETR ACTION
Date et heure locale d'exécution Quantité Informations sur la valeur Informations sur l'exécution
15/09/2026 09:58:14 55 ETF DE TEST Référence : 123456789
Type d'ordre : à cours limite Cours demandé : 6,8890 EUR
Code ISIN : IE0002XZSHO1 Cours exécuté : 6,8890 EUR
Lieu d'exécution : EURONEXT PARIS
Montant transaction brut Intérêts Montant transaction total brut Courtages Montant transaction net
378,90 EUR 0,00 EUR 000 jours 378,90 EUR 0,00 EUR 0,00 EUR
Commission Frais divers Montant total des frais
0,00 EUR 0,00 EUR 0,00 EUR
Montant net au débit de votre compte 378,90 EUR`;
it('lit un avis avec référence broker, cours précis, brut arrondi et heure Paris', () => {
  const data = parseBoursoNotice(notice);
  expect(data).toMatchObject({
    type: 'BUY',
    isin: 'IE0002XZSHO1',
    quantity: '55',
    unit_price: '6.889',
    amount: '378.9',
    fees: '0',
    external_reference: '123456789',
    occurred_at: '2026-09-15T07:58:14.000Z',
  });
  expect(
    normalizeCsvTransaction(data, '12345678-1234-4123-a123-123456789012', { platform: 'PEA' })
      .amount,
  ).toBe('378.9');
  expect(parseBoursoNotice(notice.replaceAll('15/09/2026', '15/01/2026')).occurred_at).toBe(
    '2026-01-15T08:58:14.000Z',
  );
});
it('lit le cas WPEA du 07/10/2026, y compris un ISIN PDF espacé et en minuscules', () => {
  const real = notice
    .replace('15/09/2026', '07/10/2026')
    .replace('55 ETF DE TEST', '30 iShares MSCI World Swap PEA UCITS ETF')
    .replaceAll('6,8890', '7,1930')
    .replaceAll('378,90', '215,79')
    .replace('0,00 EUR 0,00 EUR 0,00 EUR\nMontant net', '1,08 EUR 0,00 EUR 1,08 EUR\nMontant net')
    .replace('débit de votre compte 215,79', 'débit de votre compte 216,87')
    .replace('IE0002XZSHO1', 'ie0002 xzsho1');
  expect(parseBoursoNotice(real)).toMatchObject({
    isin: 'IE0002XZSHO1',
    quantity: '30',
    unit_price: '7.193',
    amount: '215.79',
    fees: '1.08',
    occurred_at: '2026-10-07T07:58:14.000Z',
    name: 'iShares MSCI World Swap PEA UCITS ETF',
  });
});
it('valide une vente et ses frais sans confondre net et brut', () => {
  const sell = notice
    .replace('ACHAT', 'VENTE')
    .replace('0,00 EUR 0,00 EUR 0,00 EUR\nMontant net', '1,00 EUR 0,50 EUR 1,50 EUR\nMontant net')
    .replace('débit de votre compte 378,90', 'crédit de votre compte 377,40');
  expect(parseBoursoNotice(sell)).toMatchObject({ type: 'SELL', amount: '378.9', fees: '1.5' });
});
it('refuse scans, documents multiples, lieux inconnus et montants incohérents', () => {
  for (const text of [
    '',
    notice + notice,
    notice.replace('EURONEXT PARIS', 'NASDAQ'),
    notice.replace('débit de votre compte 378,90', 'débit de votre compte 380,90'),
  ])
    expect(() => parseBoursoNotice(text)).toThrow();
});
