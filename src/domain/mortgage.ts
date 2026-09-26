import { decimal as d, D } from './money';
import { mortgageSchema, type Mortgage } from '@/shared/real-estate';

// Parameters are the source of truth. Dates are UTC calendar dates; the first
// instalment is one month after drawdown, clamped to the original day of month.
export function monthlyPayment(principal: string, annualPercent: string, months: number) {
  if (
    !Number.isInteger(months) ||
    months < 1 ||
    months > 600 ||
    !d(principal).gt(0) ||
    !d(annualPercent).gte(0)
  )
    throw new Error('Paramètres du crédit invalides.');
  const rate = d(annualPercent).div(100).div(12);
  return (
    rate.isZero()
      ? d(principal).div(months)
      : d(principal)
          .mul(rate)
          .div(d(1).sub(d(1).add(rate).pow(-months)))
  )
    .toDecimalPlaces(2)
    .toFixed(2);
}
function dueDate(start: string, month: number) {
  const date = new Date(`${start}T00:00:00Z`);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + month + 1, 0));
  last.setUTCDate(Math.min(date.getUTCDate(), last.getUTCDate()));
  return last.toISOString().slice(0, 10);
}
export type Instalment = {
  number: number;
  date: string;
  payment: string;
  interest: string;
  principal: string;
  remainingPrincipal: string;
  insurance: string;
  totalPayment: string;
};
export function amortization(input: Mortgage): Instalment[] {
  const loan = mortgageSchema.parse(input);
  const payment = d(
    monthlyPayment(loan.borrowedAmount, loan.annualInterestRate, loan.durationMonths),
  );
  const rate = d(loan.annualInterestRate).div(1200);
  let balance = d(loan.borrowedAmount);
  const rows: Instalment[] = [];
  for (let month = 1; month <= loan.durationMonths && balance.gt(0); month++) {
    const interest = balance.mul(rate).toDecimalPlaces(2);
    const principal =
      month === loan.durationMonths ? balance : D.max(0, D.min(balance, payment.sub(interest)));
    balance = balance.sub(principal);
    const paid = principal.add(interest);
    rows.push({
      number: month,
      date: dueDate(loan.startDate, month),
      payment: paid.toFixed(2),
      interest: interest.toFixed(2),
      principal: principal.toFixed(2),
      remainingPrincipal: balance.toFixed(2),
      insurance: d(loan.monthlyInsurance).toFixed(2),
      totalPayment: paid.add(loan.monthlyInsurance).toFixed(2),
    });
  }
  return rows;
}
export function mortgageAt(loan: Mortgage, at: Date, schedule = amortization(loan)) {
  const day = at.toISOString().slice(0, 10);
  const paid = schedule.filter((row) => row.date <= day);
  const sum = (rows: Instalment[], key: 'principal' | 'interest' | 'insurance') =>
    rows.reduce((total, row) => total.add(row[key]), d(0));
  const principalPaid = sum(paid, 'principal');
  const interestPaid = sum(paid, 'interest');
  const totalInterest = sum(schedule, 'interest');
  const insurancePaid = sum(paid, 'insurance');
  const totalInsurance = sum(schedule, 'insurance');
  return {
    remainingPrincipal: (day < loan.startDate
      ? d(0)
      : d(loan.borrowedAmount).sub(principalPaid)
    ).toFixed(2),
    principalPaid: principalPaid.toFixed(2),
    interestPaid: interestPaid.toFixed(2),
    interestRemaining: totalInterest.sub(interestPaid).toFixed(2),
    totalInterest: totalInterest.toFixed(2),
    insurancePaid: insurancePaid.toFixed(2),
    insuranceRemaining: totalInsurance.sub(insurancePaid).toFixed(2),
    totalInsurance: totalInsurance.toFixed(2),
    totalCost: totalInterest.add(totalInsurance).add(loan.originationFees).toFixed(2),
    costsPaid: interestPaid
      .add(insurancePaid)
      .add(day >= loan.startDate ? loan.originationFees : 0)
      .toFixed(2),
    costsRemaining: totalInterest
      .sub(interestPaid)
      .add(totalInsurance.sub(insurancePaid))
      .add(day < loan.startDate ? loan.originationFees : 0)
      .toFixed(2),
    remainingPayments: schedule.length - paid.length,
    endDate: schedule.at(-1)!.date,
    progressPercent: principalPaid.div(loan.borrowedAmount).mul(100).toFixed(2),
    monthlyPayment: monthlyPayment(
      loan.borrowedAmount,
      loan.annualInterestRate,
      loan.durationMonths,
    ),
    active: day >= loan.startDate && paid.length < schedule.length,
  };
}
