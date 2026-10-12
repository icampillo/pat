import { decimal as d, precise } from './money';
import { mortgageAt } from './mortgage';
import { propertyMortgages, type RealEstate } from '@/shared/real-estate';

export function realEstateAt(
  property: RealEstate,
  at: Date,
  currentValue = property.valuationDate && property.valuationDate <= at.toISOString().slice(0, 10)
    ? property.currentValue
    : null,
) {
  const share = d(property.ownershipPercent).div(100);
  const ownedValue = currentValue === null ? null : d(currentValue).mul(share);
  const loans = propertyMortgages(property);
  const mortgages = loans.map((loan) => mortgageAt(loan, at));
  const mortgage = property.mortgage ? mortgages[0] : null;
  const debt = precise(mortgages.reduce((sum, loan) => sum.add(loan.remainingPrincipal), d(0)));
  const borrowedAmount = loans.reduce((sum, loan) => sum.add(loan.borrowedAmount), d(0));
  const principalPaid = mortgages.reduce((sum, loan) => sum.add(loan.principalPaid), d(0));
  const monthlyDebtService = mortgages.reduce(
    (sum, loan, index) =>
      loan.active ? sum.add(loan.monthlyPayment).add(loans[index].monthlyInsurance) : sum,
    d(0),
  );
  const acquisitionCost = d(property.purchasePrice)
    .add(property.acquisitionFees)
    .add(property.initialRenovations);
  const rental = property.usage === 'RENTAL' ? property.rental : undefined;
  const annualRent = rental ? d(rental.monthlyRent).mul(12) : null;
  const expenses = rental
    ? d(rental.monthlyNonRecoverableCharges)
        .mul(12)
        .add(rental.annualPropertyTax)
        .add(rental.annualOwnerInsurance)
        .add(rental.annualManagementFees)
        .add(rental.annualOtherExpenses)
    : null;
  return {
    ownedValue: ownedValue === null ? null : precise(ownedValue),
    remainingPrincipal: debt,
    borrowedAmount: precise(borrowedAmount),
    principalPaid: precise(principalPaid),
    progressPercent: borrowedAmount.isZero()
      ? null
      : precise(principalPaid.div(borrowedAmount).mul(100)),
    mortgages,
    equity: ownedValue === null ? null : precise(ownedValue.sub(debt)),
    grossGain:
      ownedValue === null ? null : precise(ownedValue.sub(d(property.purchasePrice).mul(share))),
    acquisitionCost: precise(acquisitionCost),
    acquisitionOwnedValue: precise(d(property.purchasePrice).mul(share)),
    mortgage,
    rental:
      rental && annualRent && expenses
        ? {
            annualRent: precise(annualRent),
            annualOperatingExpenses: precise(expenses),
            grossYield: d(property.purchasePrice).isZero()
              ? null
              : precise(annualRent.div(property.purchasePrice).mul(100)),
            netYield: acquisitionCost.isZero()
              ? null
              : precise(annualRent.sub(expenses).div(acquisitionCost).mul(100)),
            // Rent and operating expenses describe the whole property; debt is already attributed.
            monthlyCashFlow: precise(
              annualRent.sub(expenses).div(12).mul(share).sub(monthlyDebtService),
            ),
          }
        : null,
  };
}
export type RealEstateValuation = ReturnType<typeof realEstateAt>;
