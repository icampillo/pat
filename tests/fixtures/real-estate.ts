import { realEstateSchema, mortgageSchema } from '../../src/shared/real-estate';
export const loan = mortgageSchema.parse({
  borrowedAmount: '200000',
  downPayment: '100000',
  annualInterestRate: '3',
  durationMonths: 240,
  startDate: '2020-01-31',
});
export const property = realEstateSchema.parse({
  propertyType: 'APARTMENT',
  usage: 'PRIMARY_RESIDENCE',
  city: 'Marseille',
  country: 'FR',
  purchaseDate: '2020-01-01',
  purchasePrice: '300000',
  acquisitionFees: '20000',
  currentValue: '300000',
  valuationDate: '2020-01-01',
  ownershipPercent: '100',
  mortgage: null,
});
