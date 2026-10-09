import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { transactionSchema } from '@/shared/schemas';
import { parseCsvDecimal } from './securities-csv';
import { decimal as d, precise } from './money';

export type ImportTransaction = z.infer<typeof transactionSchema>;
export type CsvTransaction = {
  line: number;
  fields: Record<string, string>;
};
const normalize = (text: string) =>
  text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[ _-]+/g, ' ');
const aliases: Record<string, string[]> = {
  account_id: ['account id', 'identifiant compte'],
  asset_id: ['asset id'],
  asset_symbol: ['asset symbol', 'ticker', 'symbol', 'symbole'],
  isin: ['isin', 'code isin'],
  name: ['name', 'nom', 'valeur', 'libelle valeur'],
  type: [
    'type',
    'operation',
    'nature',
    'type operation',
    'type d’operation',
    "type d'operation",
    'sens',
  ],
  quantity: ['quantity', 'quantite', 'nombre de titres'],
  unit_price: ['unit price', 'prix unitaire', 'prix', 'cours'],
  amount: ['amount', 'montant', 'montant brut'],
  fees: ['fees', 'frais'],
  currency: ['currency', 'devise'],
  occurred_at: ['occurred at', 'date', 'date operation', "date d'operation", 'date d’operation'],
  platform: ['platform', 'compte', 'courtier'],
  destination: ['destination'],
  settlement: ['settlement'],
  comment: ['comment', 'commentaire'],
  external_reference: [
    'external reference',
    'id operation',
    "id d'operation",
    'reference',
    'reference operation',
    "reference d'operation",
  ],
};
export function parseTransactionCsv(csv: string): CsvTransaction[] {
  if (!csv.trim() || Buffer.byteLength(csv, 'utf8') > 200_000)
    throw new Error('Fichier vide ou supérieur à 200 Ko.');
  const header = csv.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
  const rows: Record<string, string>[] = parse(csv, {
    bom: true,
    skip_empty_lines: true,
    trim: true,
    max_record_size: 16_000,
    delimiter: header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',',
    columns: (headers: string[]) => {
      if (
        headers.includes('buyingPrice') &&
        !headers.some((h) => aliases.type.includes(normalize(h)))
      )
        throw new Error(
          'Ce fichier contient des positions instantanées, pas des transactions. Utilisez l’import de positions Bourse ; un historique daté est nécessaire pour synchroniser les opérations.',
        );
      const mapped = headers.map(
        (h) => Object.entries(aliases).find(([, names]) => names.includes(normalize(h)))?.[0] ?? h,
      );
      if (new Set(mapped).size !== mapped.length) throw new Error('Colonnes en double.');
      if (!['type', 'occurred_at'].every((h) => mapped.includes(h)))
        throw new Error('Colonnes requises : type / opération et occurred_at / date.');
      if (mapped.some((h) => !Object.hasOwn(aliases, h)))
        throw new Error(
          'Colonne non reconnue. Utilisez le modèle de transactions (les montants doivent être bruts, hors frais).',
        );
      return mapped;
    },
  });
  if (!rows.length || rows.length > 500)
    throw new Error('Importez entre 1 et 500 transactions à la fois.');
  return rows.map((fields, i) => ({ line: i + 2, fields }));
}
export function csvDate(value: string) {
  const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const date = french ? `${french[3]}-${french[2]}-${french[1]}` : value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const iso = `${date}T00:00:00.000Z`;
    if (!Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString() !== iso)
      throw new Error('Date invalide.');
    return iso;
  }
  // Une heure doit toujours avoir un fuseau explicite, indépendant de celui du serveur.
  const valid = z.iso.datetime({ offset: true }).parse(date);
  return new Date(valid).toISOString();
}
export function normalizeCsvTransaction(
  row: Record<string, string>,
  assetId: string | null,
  defaults: { platform?: string; currency?: string } = {},
): ImportTransaction {
  const type =
    (
      {
        achat: 'BUY',
        vente: 'SELL',
        dividende: 'DIVIDEND',
        frais: 'FEE',
        depot: 'DEPOSIT',
        retrait: 'WITHDRAWAL',
      } as Record<string, string>
    )[normalize(row.type)] ?? row.type.toUpperCase();
  const number = (value = '0') =>
    value.startsWith('-')
      ? `-${parseCsvDecimal(value.slice(1))}`
      : parseCsvDecimal(value.replace(/^\+/, ''));
  const quantity = number(row.quantity || '0'),
    unitPrice = number(row.unit_price || '0');
  const calculatedAmount = precise(d(quantity).mul(unitPrice));
  const suppliedAmount = number(row.amount || '0');
  const amount =
    ['BUY', 'SELL'].includes(type) && d(suppliedAmount).isZero()
      ? calculatedAmount
      : suppliedAmount;
  if (['BUY', 'SELL'].includes(type)) {
    if (!row.unit_price) throw new Error('Prix unitaire obligatoire pour un achat ou une vente.');
    // Le modèle historique emploie amount=0 comme champ inutilisé pour BUY/SELL.
    if (
      row.amount &&
      !d(number(row.amount)).isZero() &&
      d(number(row.amount)).sub(calculatedAmount).abs().gt('0.01')
    )
      throw new Error(
        'Montant incohérent avec quantité × prix. Indiquez le montant brut, hors frais.',
      );
  }
  return transactionSchema.parse({
    assetId,
    type,
    quantity,
    unitPrice,
    amount,
    fees: number(row.fees || '0'),
    currency: (row.currency || defaults.currency || '').toUpperCase(),
    platform: row.platform || defaults.platform || '',
    occurredAt: csvDate(row.occurred_at),
    destination: row.destination || null,
    settlement: row.settlement || 'EXTERNAL',
    comment: row.comment || '',
    externalReference: row.external_reference || null,
  });
}
