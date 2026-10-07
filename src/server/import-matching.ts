import { createHash } from 'node:crypto';
import type { ImportTransaction } from '@/domain/transaction-csv';
import { precise } from '@/domain/money';

export type MatchStatus = 'EXISTING' | 'NEW' | 'CHANGED' | 'AMBIGUOUS';
export type StoredTransaction = ImportTransaction & { id: string; voided: boolean };
export type MatchRow = { line: number; data: ImportTransaction };
export type Match = MatchRow & {
  status: MatchStatus;
  candidates: { id: string; differences: { field: string; before: string; after: string }[] }[];
  reason?: string;
  canCreate?: boolean;
};
const fields = [
  'assetId',
  'platform',
  'occurredAt',
  'type',
  'quantity',
  'unitPrice',
  'amount',
  'fees',
  'currency',
  'settlement',
  'destination',
] as const;
const numbers = new Set<string>(['quantity', 'unitPrice', 'amount', 'fees']);
const value = (t: ImportTransaction, key: (typeof fields)[number]) =>
  numbers.has(key)
    ? precise(t[key] || '0')
    : key === 'occurredAt'
      ? new Date(t.occurredAt).toISOString()
      : (t[key] ?? '');
export const transactionFingerprint = (t: ImportTransaction) =>
  createHash('sha256')
    .update(JSON.stringify(fields.map((key) => value(t, key))))
    .digest('hex');
export const sourceReference = (source: string, platform: string, reference: string | null) =>
  reference && source !== 'GENERIC'
    ? `broker:v1:${createHash('sha256')
        .update(JSON.stringify([source, platform, reference]))
        .digest('hex')}`
    : reference;
const generated = (reference: string | null) => !reference || reference.startsWith('csv:v1:');
const differences = (a: ImportTransaction, b: ImportTransaction) =>
  fields
    .filter((key) => value(a, key) !== value(b, key))
    .map((field) => ({ field, before: value(a, field), after: value(b, field) }));
const sameDay = (a: ImportTransaction, b: ImportTransaction) =>
  a.assetId === b.assetId &&
  a.platform === b.platform &&
  a.type === b.type &&
  a.occurredAt.slice(0, 10) === b.occurredAt.slice(0, 10);

export function matchTransactions(rows: MatchRow[], stored: StoredTransaction[]): Match[] {
  const used = new Set<string>();
  const result: Match[] = rows.map((row) => ({
    ...row,
    data: { ...row.data },
    status: 'NEW',
    candidates: [],
  }));
  const occurrences = new Map<string, number>();
  for (const row of result) {
    if (row.data.externalReference) continue;
    const hash = transactionFingerprint(row.data);
    const occurrence = (occurrences.get(hash) || 0) + 1;
    occurrences.set(hash, occurrence);
    row.data.externalReference = `csv:v1:${hash}:${occurrence}`;
  }
  const candidate = (row: Match, t: StoredTransaction) => ({
    id: t.id,
    differences: differences(t, row.data),
  });
  const accept = (row: Match, t: StoredTransaction) => {
    used.add(t.id);
    row.status = t.voided ? 'AMBIGUOUS' : differences(t, row.data).length ? 'CHANGED' : 'EXISTING';
    row.candidates = [candidate(row, t)];
    if (t.voided)
      row.reason =
        'Cette opération a été annulée dans le journal. Elle ne sera pas recréée automatiquement.';
  };
  // Les identifiants explicites sont prioritaires, avant toute correspondance de contenu.
  const refs = new Map<string, Match[]>();
  for (const row of result) {
    const ref = row.data.externalReference;
    if (ref) refs.set(ref, [...(refs.get(ref) || []), row]);
  }
  for (const [ref, group] of refs) {
    const known = stored.find((t) => t.externalReference === ref);
    if (new Set(group.map((r) => transactionFingerprint(r.data))).size > 1) {
      for (const row of group) {
        row.status = 'AMBIGUOUS';
        row.reason = 'La même référence désigne des lignes différentes dans ce fichier.';
        if (known) row.candidates = [candidate(row, known)];
      }
      if (known) used.add(known.id);
    } else {
      if (known) accept(group[0], known);
      for (const row of group.slice(1)) {
        row.status = 'EXISTING';
        row.reason = 'Référence répétée à l’identique dans le fichier : une seule opération.';
      }
    }
  }
  // Appariement multiensemble : chaque opération historique ne couvre qu’une occurrence.
  for (const row of result.filter((r) => r.status === 'NEW')) {
    const fingerprint = transactionFingerprint(row.data);
    const exact = stored.filter(
      (t) =>
        !used.has(t.id) &&
        transactionFingerprint(t) === fingerprint &&
        (generated(row.data.externalReference) || generated(t.externalReference)),
    );
    const known = exact.find((t) => !t.voided) ?? exact[0];
    if (known) accept(row, known);
  }
  for (const row of result.filter((r) => r.status === 'NEW')) {
    const possible = stored.filter(
      (t) =>
        !used.has(t.id) &&
        sameDay(t, row.data) &&
        (generated(row.data.externalReference) || generated(t.externalReference)),
    );
    // Un inventaire ne prouve jamais quels achats le constituent.
    const inventory = stored.filter(
      (t) =>
        !t.voided &&
        t.type === 'ADJUSTMENT' &&
        t.assetId === row.data.assetId &&
        t.platform === row.data.platform &&
        t.occurredAt >= row.data.occurredAt,
    );
    if (possible.length || inventory.length) {
      const candidates = possible.length ? possible : inventory;
      row.status =
        possible.length === 1 && !possible[0].voided && !inventory.length ? 'CHANGED' : 'AMBIGUOUS';
      row.candidates = candidates.map((t) => candidate(row, t));
      row.reason = inventory.length
        ? 'Un inventaire initial couvre peut-être cet historique. Vérifiez le journal avant d’ajouter ces opérations.'
        : 'Opération proche sans identifiant fiable : aucune modification automatique.';
    }
  }
  for (const row of result) {
    row.canCreate =
      ['CHANGED', 'AMBIGUOUS'].includes(row.status) &&
      row.candidates.length > 0 &&
      !row.reason?.includes('même référence') &&
      !stored.some(
        (t) =>
          t.externalReference === row.data.externalReference ||
          (t.voided && row.candidates.some((c) => c.id === t.id)),
      );
  }
  return result;
}
