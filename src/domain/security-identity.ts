import { z } from 'zod';

export const normalizeIsin = (value: string) => value.replace(/\s/g, '').toUpperCase();
export const isinSchema = z
  .string()
  .transform(normalizeIsin)
  .pipe(z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, 'ISIN invalide.'));

export function securityIsin(asset: {
  metadata: unknown;
  symbol: string;
  externalId?: string | null;
}) {
  const meta = asset.metadata as Record<string, unknown>;
  // Un ISIN explicite reste prioritaire sur les anciens champs de repli.
  for (const value of [meta.isin, asset.externalId, asset.symbol]) {
    const parsed = isinSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}
