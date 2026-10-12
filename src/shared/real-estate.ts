import { z } from 'zod';
import { decimal as d } from '@/domain/money';

const amount = z.string().regex(/^\d{1,15}(\.\d{1,2})?$/, 'Montant positif, au centime près.');
const positive = amount.pipe(
  z.string().refine((v) => d(v).gt(0), 'Montant strictement positif requis.'),
);
const percent = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,6})?$/)
  .pipe(z.string().refine((v) => d(v).lte(100), 'Maximum : 100 %.'));
const pastDate = z.iso
  .date()
  .refine((v) => v <= new Date().toISOString().slice(0, 10), 'La date ne peut pas être future.');
export const propertyTypes = {
  APARTMENT: 'Appartement',
  HOUSE: 'Maison',
  LAND: 'Terrain',
  PARKING: 'Parking',
  OTHER: 'Autre',
} as const;
export const propertyUsages = {
  PRIMARY_RESIDENCE: 'Résidence principale',
  SECONDARY_RESIDENCE: 'Résidence secondaire',
  RENTAL: 'Location',
} as const;
export const mortgageSchema = z
  .object({
    borrowedAmount: positive,
    downPayment: amount,
    annualInterestRate: percent,
    durationMonths: z.number().int().min(1).max(600),
    startDate: z.iso.date(),
    monthlyInsurance: amount.default('0'),
    originationFees: amount.default('0'),
    balanceObservations: z
      .array(
        z
          .object({
            date: pastDate,
            remainingPrincipal: amount,
          })
          .strict(),
      )
      .max(1000)
      .optional(),
  })
  .strict()
  .superRefine((loan, ctx) => {
    for (const [index, observation] of (loan.balanceObservations ?? []).entries()) {
      if (
        observation.date < loan.startDate ||
        (index > 0 && observation.date <= loan.balanceObservations![index - 1].date)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['balanceObservations', index, 'date'],
          message:
            'Les relevés doivent suivre le début du prêt et être strictement chronologiques.',
        });
      if (d(observation.remainingPrincipal).gt(loan.borrowedAmount))
        ctx.addIssue({
          code: 'custom',
          path: ['balanceObservations', index, 'remainingPrincipal'],
          message: 'Le capital restant dû ne peut pas dépasser le montant initial de ce prêt.',
        });
    }
  });
export type Mortgage = z.infer<typeof mortgageSchema>;
export const rentalSchema = z
  .object({
    monthlyRent: amount,
    monthlyNonRecoverableCharges: amount,
    annualPropertyTax: amount,
    annualOwnerInsurance: amount.default('0'),
    annualManagementFees: amount.default('0'),
    annualOtherExpenses: amount.default('0'),
  })
  .strict();
export const realEstateSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    propertyType: z.enum(
      Object.keys(propertyTypes) as [keyof typeof propertyTypes, ...(keyof typeof propertyTypes)[]],
    ),
    usage: z.enum(['PRIMARY_RESIDENCE', 'SECONDARY_RESIDENCE', 'RENTAL']),
    city: z.string().trim().min(1).max(120),
    country: z.string().trim().min(2).max(120),
    address: z.string().trim().max(300).optional(),
    purchaseDate: pastDate,
    purchasePrice: amount,
    acquisitionFees: amount,
    initialRenovations: amount.default('0'),
    currentValue: amount.nullable(),
    valuationDate: pastDate.nullable(),
    ownershipPercent: percent,
    mortgage: mortgageSchema.nullable(),
    additionalMortgages: z.array(mortgageSchema).max(19).optional(),
    rental: rentalSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.currentValue === null) !== (value.valuationDate === null))
      ctx.addIssue({
        code: 'custom',
        path: ['valuationDate'],
        message: 'Renseignez ensemble la valeur et la date d’estimation.',
      });
    if (value.valuationDate && value.valuationDate < value.purchaseDate)
      ctx.addIssue({
        code: 'custom',
        path: ['valuationDate'],
        message: 'L’estimation doit suivre l’acquisition.',
      });
    if (value.usage !== 'RENTAL' && value.rental)
      ctx.addIssue({
        code: 'custom',
        path: ['rental'],
        message: 'Les loyers concernent uniquement les biens locatifs.',
      });
    if (value.usage === 'RENTAL' && !value.rental)
      ctx.addIssue({
        code: 'custom',
        path: ['rental'],
        message: 'Renseignez le loyer et les charges obligatoires, même nuls.',
      });
  });
export type RealEstate = z.infer<typeof realEstateSchema>;

// Keep legacy single-loan records readable without a database migration.
export function propertyMortgages(property: RealEstate): Mortgage[] {
  return [
    ...(property.mortgage ? [property.mortgage] : []),
    ...(property.additionalMortgages ?? []),
  ];
}
