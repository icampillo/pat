import { createHash } from 'node:crypto';
import { securityIsin } from '@/domain/security-identity';
import type { TxDb } from './portfolio-store';

export type ImportAccount = { id: string; name: string };
type ImportAsset = {
  id: string;
  platform: string;
  symbol: string;
  externalId?: string | null;
  metadata: unknown;
  category: { key: string };
};
// Compatibilité sans migration des anciennes fiches : égalité exacte uniquement.
// L'UUID est persisté dans Platform à la première confirmation utilisant ce compte.
function legacyAccountId(portfolioId: string, name: string) {
  const h = createHash('sha256')
    .update(JSON.stringify(['account', portfolioId, name]))
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function importAccounts(
  portfolioId: string,
  platforms: ImportAccount[],
  assets: { platform: string; metadata?: unknown }[],
) {
  const accounts = [...platforms];
  for (const asset of assets) {
    const linked = (asset.metadata as Record<string, unknown> | undefined)?.accountId;
    if (linked && accounts.some((a) => a.id === linked)) continue;
    if (!accounts.some((a) => a.name === asset.platform))
      accounts.push({ id: legacyAccountId(portfolioId, asset.platform), name: asset.platform });
  }
  return accounts;
}
export function selectImportAccount(
  portfolioId: string,
  accounts: ImportAccount[],
  name: string,
  id?: string,
) {
  if (id) {
    const account = accounts.find((a) => a.id === id);
    if (!account)
      throw new Error(
        'Compte introuvable dans ce portefeuille. Sélectionnez le compte destinataire.',
      );
    return account;
  }
  if (!name) throw new Error('Sélectionnez le compte destinataire.');
  return accounts.find((a) => a.name === name) ?? { id: legacyAccountId(portfolioId, name), name };
}
export async function persistImportAccount(tx: TxDb, portfolioId: string, account: ImportAccount) {
  const saved = await tx.platform.upsert({
    where: { portfolioId_name: { portfolioId, name: account.name } },
    create: { id: account.id, portfolioId, name: account.name },
    update: {},
  });
  if (saved.id !== account.id) throw new Error('Le compte a changé. Recréez l’aperçu.');
}
export function matchesImportAsset(
  asset: ImportAsset,
  account: ImportAccount,
  input: { assetId?: string; isin?: string; ticker?: string },
) {
  const meta = asset.metadata as Record<string, string>;
  const sameAccount = meta.accountId
    ? meta.accountId === account.id
    : asset.platform === account.name;
  if (!sameAccount) return false;
  if (input.assetId)
    return asset.id === input.assetId && (!input.isin || securityIsin(asset) === input.isin);
  if (input.isin) return asset.category.key === 'SECURITIES' && securityIsin(asset) === input.isin;
  return (
    !!input.ticker &&
    [meta.ticker, asset.symbol].some(
      (s) => s?.trim().toUpperCase() === input.ticker?.trim().toUpperCase(),
    )
  );
}
