import { z } from 'zod';
import { decimal } from '@/domain/money';
import { realEstateSchema } from './real-estate';
export const categories = [
  { key: 'CRYPTO', label: 'Cryptomonnaies', color: '#6366f1' },
  { key: 'METALS', label: 'Métaux précieux', color: '#c68b2c' },
  { key: 'SECURITIES', label: 'Bourse', color: '#0d9488' },
  { key: 'POKEMON', label: 'Cartes Pokémon', color: '#e55784' },
  { key: 'ONE_PIECE', label: 'Cartes One Piece', color: '#368fe0' },
  { key: 'REAL_ESTATE', label: 'Immobilier', color: '#b7791f' },
  { key: 'OTHER', label: 'Autres actifs', color: '#8190a6' },
] as const;
export const typeLabels: Record<string, string> = {
  BUY: 'Achat',
  SELL: 'Vente',
  DEPOSIT: 'Dépôt',
  WITHDRAWAL: 'Retrait',
  TRANSFER: 'Transfert',
  FEE: 'Frais',
  DIVIDEND: 'Dividende',
  REWARD: 'Récompense',
  ADJUSTMENT: 'Ajustement initial',
};
export const decimalSchema = z
  .string()
  .regex(/^-?\d{1,15}(\.\d{1,18})?$/, 'Nombre décimal attendu (point comme séparateur).');
const nonnegative = decimalSchema.refine(
  (v) => decimal(v).gte(0),
  'La valeur doit être positive ou nulle.',
);
const positive = nonnegative.refine(
  (v) => decimal(v).gt(0),
  'La valeur doit être supérieure à zéro.',
);
export const currencySchema = z.enum(['EUR', 'USD']);
export const dateSchema = z.iso
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) <= Date.now() + 60_000, 'La date ne peut pas être future.');
const text = z.string().trim().max(120);
export const metadataSchema = z
  .object({
    realEstate: realEstateSchema.optional(),
    costBasis: z.enum(['KNOWN', 'UNKNOWN']).optional(),
    network: text.optional(),
    contractAddress: z.string().max(200).optional(),
    stakingRate: nonnegative.optional(),
    metalType: z.enum(['GOLD', 'SILVER']).optional(),
    purity: positive.refine((v) => decimal(v).lte(1), 'Pureté maximale : 1.').optional(),
    weightGrams: positive.optional(),
    coinType: text.optional(),
    year: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    country: text.optional(),
    faceValue: nonnegative.optional(),
    pricingMode: z
      .enum(['MANUAL', 'GRAM', 'METAL_MARKET', 'SECURITIES_MARKET', 'CUSTOM_COIN'])
      .optional(),
    gramPrice: nonnegative.optional(),
    premium: nonnegative.optional(),
    ticker: text.optional(),
    exchange: text.optional(),
    isin: text.optional(),
    instrumentType: z.enum(['STOCK', 'ETF']).optional(),
    setName: text.optional(),
    cardNumber: text.optional(),
    language: text.optional(),
    condition: text.optional(),
    grade: text.optional(),
    gradingCompany: text.optional(),
    certificateNumber: text.optional(),
    referenceUrl: z
      .url()
      .max(2048)
      .refine((v) => v.startsWith('https://'), 'Lien HTTPS requis.')
      .optional(),
  })
  .strict();
export const assetSchema = z
  .object({
    name: text.min(1, 'Nom obligatoire.'),
    symbol: z.string().trim().min(1).max(100),
    categoryId: z.uuid(),
    currency: currencySchema,
    platform: text.min(1),
    notes: z.string().max(5000).default(''),
    subcategory: text.default(''),
    externalId: text.default(''),
    metadata: metadataSchema.default({}),
    status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
  })
  .strict();
export const assetCreationSchema = assetSchema
  .extend({ quantity: positive.optional(), acquisitionCost: positive.optional() })
  .superRefine((value, context) => {
    if (value.acquisitionCost && !value.quantity)
      context.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'Indiquez la quantité associée au coût.',
      });
  });
export const assetUpdateSchema = assetSchema.extend({ acquisitionCost: positive.optional() });
export const transactionSchema = z
  .object({
    assetId: z.uuid().nullable(),
    type: z.enum([
      'BUY',
      'SELL',
      'DEPOSIT',
      'WITHDRAWAL',
      'TRANSFER',
      'FEE',
      'DIVIDEND',
      'REWARD',
      'ADJUSTMENT',
    ]),
    quantity: decimalSchema.default('0'),
    unitPrice: nonnegative.default('0'),
    fees: nonnegative.default('0'),
    amount: nonnegative.default('0'),
    currency: currencySchema,
    platform: text.min(1),
    destination: text.nullable().default(null),
    settlement: z.enum(['EXTERNAL', 'INTERNAL']).default('EXTERNAL'),
    occurredAt: dateSchema,
    comment: z.string().max(5000).default(''),
    externalReference: z.string().trim().min(1).max(150).nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (['BUY', 'SELL', 'REWARD', 'ADJUSTMENT', 'DIVIDEND'].includes(v.type) && !v.assetId)
      fail('assetId', 'Sélectionnez un actif.');
    if (
      v.assetId &&
      v.type !== 'DIVIDEND' &&
      (v.type === 'ADJUSTMENT' ? decimal(v.quantity).isZero() : decimal(v.quantity).lte(0))
    )
      fail('quantity', 'Quantité invalide.');
    if (!v.assetId && decimal(v.amount).lte(0))
      fail('amount', 'Montant strictement positif requis.');
    if (v.type === 'DIVIDEND' && decimal(v.amount).lte(0))
      fail('amount', 'Montant du dividende requis.');
    if (['DEPOSIT', 'WITHDRAWAL'].includes(v.type) && v.assetId && decimal(v.amount).lte(0))
      fail('amount', 'Valeur au moment du transfert requise.');
    if (v.type === 'TRANSFER' && (!v.destination || v.destination === v.platform))
      fail('destination', 'Choisissez une autre plateforme.');
    if (!['BUY', 'SELL'].includes(v.type) && !decimal(v.fees).isZero())
      fail('fees', 'Enregistrez les frais comme une opération distincte.');
    if (v.type === 'ADJUSTMENT' && !v.comment.trim()) fail('comment', 'Un motif est obligatoire.');
  });
export const priceSchema = z.union([
  z.object({ price: nonnegative, observedAt: dateSchema }).strict(),
  z
    .object({ gramPrice: nonnegative, premium: nonnegative.default('0'), observedAt: dateSchema })
    .strict(),
]);
export const transactionEditSchema = z
  .object({
    transaction: transactionSchema,
    reason: z.string().trim().min(3, 'Expliquez la correction.').max(500),
  })
  .strict();
export const fxSchema = z.object({ eurUsd: positive, observedAt: dateSchema }).strict();
export const settingsSchema = z
  .object({
    displayCurrency: currencySchema,
    name: text.min(1),
    timezone: z.enum(['Europe/Paris', 'UTC']),
  })
  .strict();
