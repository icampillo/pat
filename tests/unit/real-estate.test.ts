import { describe, expect, it } from 'vitest';
import { amortization, mortgageAt, monthlyPayment } from '../../src/domain/mortgage';
import { realEstateAt } from '../../src/domain/real-estate';
import { decimal as d } from '../../src/domain/money';
import { mortgageSchema, realEstateSchema, rentalSchema } from '../../src/shared/real-estate';
import { loan, property } from '../fixtures/real-estate';

describe('fixed-rate amortization', () => {
  it('repays 200000 at 3% over 240 months exactly, including the final cent', () => {
    const rows = amortization(loan);
    expect(monthlyPayment('200000', '3', 240)).toBe('1109.20');
    expect(rows).toHaveLength(240);
    expect(rows.reduce((sum, row) => sum.add(row.principal), d(0)).toFixed(2)).toBe('200000.00');
    expect(rows.at(-1)?.remainingPrincipal).toBe('0.00');
    expect(Number(mortgageAt(loan, new Date('2041-01-01')).totalInterest)).toBeCloseTo(66206.85, 0);
    for (const row of rows) {
      expect(d(row.principal).add(row.interest).toFixed(2)).toBe(row.payment);
      expect(d(row.payment).add(row.insurance).toFixed(2)).toBe(row.totalPayment);
    }
  });
  it('handles zero rates, completed loans and before drawdown', () => {
    const zero = {
      ...loan,
      borrowedAmount: '120000',
      annualInterestRate: '0',
      durationMonths: 120,
    };
    expect(monthlyPayment('120000', '0', 120)).toBe('1000.00');
    expect(mortgageAt(zero, new Date('2031-01-01'))).toMatchObject({
      remainingPrincipal: '0.00',
      interestRemaining: '0.00',
      totalInterest: '0.00',
      remainingPayments: 0,
      progressPercent: '100.00',
    });
    expect(mortgageAt(zero, new Date('2019-01-01')).remainingPrincipal).toBe('0.00');
    expect(mortgageAt(zero, new Date('2020-01-31')).remainingPrincipal).toBe('120000.00');
  });
  it('clamps end-of-month dates without cumulative drift and includes payments on the due date', () => {
    const rows = amortization(loan);
    expect(rows.slice(0, 3).map((r) => r.date)).toEqual(['2020-02-29', '2020-03-31', '2020-04-30']);
    expect(mortgageAt(loan, new Date('2020-02-28T23:59:59Z')).principalPaid).toBe('0.00');
    expect(mortgageAt(loan, new Date('2020-02-29T00:00:00Z')).principalPaid).toBe('609.20');
  });
  it('uses percentage points, supports rounded tiny payments and balances insurance costs', () => {
    expect(monthlyPayment('200000', '3.2', 240)).toBe('1129.33');
    expect(monthlyPayment('200000', '0.032', 240)).not.toBe('1129.33');
    expect(
      amortization({ ...loan, borrowedAmount: '0.01', annualInterestRate: '0' }).at(-1)
        ?.remainingPrincipal,
    ).toBe('0.00');
    const result = mortgageAt(
      { ...loan, monthlyInsurance: '30', originationFees: '1000' },
      new Date('2021-01-31'),
    );
    expect(result.insurancePaid).toBe('360.00');
    expect(result.totalInsurance).toBe('7200.00');
    expect(d(result.costsPaid).add(result.costsRemaining).toFixed(2)).toBe(result.totalCost);
    expect(d(result.interestPaid).add(result.interestRemaining).toFixed(2)).toBe(
      result.totalInterest,
    );
  });
});
describe('property valuation and rental estimates', () => {
  const at = new Date('2020-01-31');
  it('subtracts attributed debt once, handles co-ownership, no loan and negative equity', () => {
    expect(
      realEstateAt({ ...property, mortgage: { ...loan, borrowedAmount: '180000' } }, at).equity,
    ).toBe('120000');
    expect(
      realEstateAt(
        {
          ...property,
          currentValue: '400000',
          ownershipPercent: '50',
          mortgage: { ...loan, borrowedAmount: '120000' },
        },
        at,
      ),
    ).toMatchObject({ ownedValue: '200000', equity: '80000' });
    expect(realEstateAt({ ...property, ownershipPercent: '50' }, at).equity).toBe('150000');
    expect(
      realEstateAt({ ...property, mortgage: { ...loan, borrowedAmount: '400000' } }, at).equity,
    ).toBe('-100000');
  });
  it('preserves unknown vs zero and does not call repayment a property gain', () => {
    expect(realEstateAt(property, new Date('2019-12-31')).equity).toBeNull();
    expect(
      realEstateAt({ ...property, currentValue: null, valuationDate: null }, at).equity,
    ).toBeNull();
    expect(realEstateAt({ ...property, currentValue: '0' }, at).equity).toBe('0');
    const mortgaged = { ...property, mortgage: loan };
    const before = realEstateAt(mortgaged, at),
      after = realEstateAt(mortgaged, new Date('2021-01-31'));
    expect(d(after.equity!).gt(before.equity!)).toBe(true);
    expect(after.grossGain).toBe('0');
  });
  it('calculates rental yields excluding principal from expenses and cash flow including debt service', () => {
    const rental = rentalSchema.parse({
      monthlyRent: '1500',
      monthlyNonRecoverableCharges: '100',
      annualPropertyTax: '1200',
    });
    const result = realEstateAt(
      { ...property, usage: 'RENTAL', rental, mortgage: { ...loan, monthlyInsurance: '30' } },
      at,
    ).rental!;
    expect(result).toMatchObject({
      annualRent: '18000',
      annualOperatingExpenses: '2400',
      grossYield: '6',
      netYield: '4.875',
      monthlyCashFlow: '160.8',
    });
    expect(
      realEstateAt({ ...property, usage: 'RENTAL', rental, ownershipPercent: '50' }, at).rental
        ?.monthlyCashFlow,
    ).toBe('650');
    expect(
      realEstateAt({ ...property, usage: 'RENTAL', rental, mortgage: loan }, new Date('2041-01-01'))
        .rental?.monthlyCashFlow,
    ).toBe('1300');
    expect(realEstateAt(property, at).rental).toBeNull();
    expect(
      realEstateAt(
        { ...property, purchasePrice: '0', acquisitionFees: '0', usage: 'RENTAL', rental },
        at,
      ).rental?.netYield,
    ).toBeNull();
  });
  it('validates boundaries and rejects unrecognized metadata or a competing payment', () => {
    for (const patch of [
      { durationMonths: 0 },
      { durationMonths: 1.5 },
      { annualInterestRate: '-1' },
      { annualInterestRate: 'bad' },
      { borrowedAmount: '' },
      { monthlyPayment: '123' },
      { startDate: '2020-02-30' },
    ])
      expect(mortgageSchema.safeParse({ ...loan, ...patch }).success).toBe(false);
    for (const patch of [
      { ownershipPercent: '101' },
      { ownershipPercent: '-1' },
      { currentValue: null },
      { currentValue: undefined },
      { usage: 'RENTAL' },
      { extra: true },
    ])
      expect(realEstateSchema.safeParse({ ...property, ...patch }).success).toBe(false);
    expect(realEstateSchema.safeParse({ ...property, ownershipPercent: '0' }).success).toBe(true);
  });
});
