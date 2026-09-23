import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { decimal as d, precise } from './money';
import { marketSymbolSchema } from '@/modules/prices/securities';

const normalized = (text: string) =>
  text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
const aliases: Record<string, string[]> = {
  ticker: ['ticker', 'symbol', 'symbole', 'code mnémonique'],
  isin: ['isin', 'code isin'],
  name: ['name', 'nom', 'instrument', 'produit', 'libellé'],
  quantity: ['quantity', 'quantité', 'shares', 'nombre', 'nombre de titres'],
  acquisitionCost: [
    'acquisition cost',
    'cost basis',
    'coût total',
    'coût acquisition',
    'coût d’acquisition total',
    'total cost',
  ],
  averagePrice: [
    'average price',
    'buyingPrice',
    'prix moyen',
    'pru',
    'prix de revient',
    'prix de revient unitaire',
  ],
  currency: ['currency', 'devise', 'devise du coût'],
  platform: ['platform', 'plateforme', 'courtier', 'broker', 'compte'],
};
export const securityCsvRowSchema = z.object({
  line: z.number().int().positive(),
  ticker: marketSymbolSchema.optional(),
  isin: z
    .string()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, 'ISIN invalide.')
    .optional(),
  name: z.string().max(120).optional(),
  quantity: z.string().refine((value) => d(value).gt(0)),
  acquisitionCost: z.string().nullable(),
  costCurrency: z.enum(['EUR', 'USD']).nullable(),
  platform: z.string().min(1).max(120),
  quoteCurrency: z.enum(['EUR', 'USD']).nullable(),
  costSource: z.enum(['TOTAL', 'PRU', 'BOURSO_PNL', 'UNKNOWN']),
});
export type SecurityCsvRow = z.infer<typeof securityCsvRowSchema>;

export function parseCsvDecimal(value: string) {
  let text = value.trim().replace(/[\s\u00a0\u202f]/g, '');
  if (text.includes(',') && text.includes('.')) {
    text =
      text.lastIndexOf(',') > text.lastIndexOf('.')
        ? text.replaceAll('.', '').replace(',', '.')
        : text.replaceAll(',', '');
  } else text = text.replace(',', '.');
  if (!/^\d{1,15}(\.\d{1,18})?$/.test(text))
    throw new Error('Nombre invalide : utilisez un montant positif, sans symbole de devise.');
  return precise(text);
}
export function parseSecuritiesCsv(
  csv: string,
  defaultPlatform = 'BoursoBank',
  boursoCurrency: 'EUR' | 'USD' = 'EUR',
): { rows: SecurityCsvRow[]; errors: { line: number; message: string }[] } {
  if (!csv.trim() || Buffer.byteLength(csv, 'utf8') > 200_000)
    throw new Error('Fichier CSV vide ou supérieur à 200 Ko.');
  const header = csv.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
  const delimiter = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';
  const bourso = ['buyingPrice', 'lastPrice', 'intradayVariation', 'amountVariation'].every(
    (column) => header.includes(column),
  );
  const records: Record<string, string>[] = parse(csv, {
    delimiter,
    bom: true,
    trim: true,
    skip_empty_lines: true,
    max_record_size: 16000,
    columns: (headers: string[]) => {
      const mapped = headers.map(
        (name) =>
          Object.entries(aliases).find(([, values]) =>
            values.some((value) => normalized(value) === normalized(name)),
          )?.[0] ?? normalized(name),
      );
      if (new Set(mapped).size !== mapped.length)
        throw new Error('Plusieurs colonnes correspondent au même champ.');
      if (!mapped.includes('quantity') || !mapped.some((name) => ['ticker', 'isin'].includes(name)))
        throw new Error('Colonnes requises : quantity (quantité) et ticker ou isin.');
      if (mapped.some((name) => ['type', 'side', 'operation', 'transaction type'].includes(name)))
        throw new Error(
          'Ce fichier semble contenir des transactions. Importez un relevé de positions actuelles.',
        );
      return mapped;
    },
  });
  if (!records.length || records.length > 100)
    throw new Error('Importez entre 1 et 100 positions à la fois.');
  const rows: SecurityCsvRow[] = [],
    errors: { line: number; message: string }[] = [];
  for (const [index, record] of records.entries()) {
    try {
      const quantity = parseCsvDecimal(record.quantity);
      if (d(quantity).lte(0)) throw new Error('La quantité détenue doit être positive.');
      const totalCost = record.acquisitionCost ? parseCsvDecimal(record.acquisitionCost) : null;
      const averageCost = record.averagePrice
        ? precise(d(parseCsvDecimal(record.averagePrice)).mul(quantity))
        : null;
      if (
        totalCost !== null &&
        averageCost !== null &&
        d(totalCost).sub(averageCost).abs().gt('0.01')
      )
        throw new Error('Le coût total ne correspond pas au PRU multiplié par la quantité.');
      let acquisitionCost = totalCost ?? averageCost;
      let costSource: SecurityCsvRow['costSource'] =
        totalCost !== null ? 'TOTAL' : averageCost !== null ? 'PRU' : 'UNKNOWN';
      // Bourso exports a rounded PRU; valuation minus latent gain preserves the cost to cents.
      if (bourso && record.amount && record.amountvariation && averageCost !== null) {
        const pnlText = record.amountvariation.trim();
        const pnl = d(parseCsvDecimal(pnlText.replace(/^[+-]/, ''))).mul(
          pnlText.startsWith('-') ? -1 : 1,
        );
        const impliedCost = d(parseCsvDecimal(record.amount)).sub(pnl);
        if (
          impliedCost.lt(0) ||
          impliedCost.sub(averageCost).abs().gt(d(quantity).mul('0.005').add('0.02'))
        )
          throw new Error('Le PRU, la valorisation et la plus-value Bourso ne sont pas cohérents.');
        acquisitionCost = precise(impliedCost);
        costSource = 'BOURSO_PNL';
      }
      const costCurrency = record.currency?.toUpperCase() || (bourso ? boursoCurrency : null);
      if (acquisitionCost !== null && !costCurrency)
        throw new Error('Indiquez la devise du coût d’acquisition (EUR ou USD).');
      if (!record.ticker && !record.isin) throw new Error('Ticker ou ISIN manquant.');
      rows.push(
        securityCsvRowSchema.parse({
          line: index + 2,
          quantity,
          acquisitionCost,
          costCurrency,
          quoteCurrency: bourso ? boursoCurrency : null,
          costSource,
          ticker: record.ticker || undefined,
          isin: record.isin?.toUpperCase() || undefined,
          name: record.name || undefined,
          platform: record.platform || defaultPlatform,
        }),
      );
    } catch (error) {
      errors.push({
        line: index + 2,
        message: error instanceof z.ZodError ? error.issues[0].message : (error as Error).message,
      });
    }
  }
  return { rows, errors };
}
