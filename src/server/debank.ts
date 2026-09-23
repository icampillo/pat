import { z } from 'zod';
import { decimal as d, precise } from '@/domain/money';
import type { WalletData, WalletToken, DefiPosition } from '@/shared/wallets';

export const addressSchema = z
  .string()
  .trim()
  .transform((value) => {
    if (/^https:\/\/(www\.)?debank\.com\/profile\//i.test(value)) {
      try {
        return new URL(value).pathname.split('/')[2]?.toLowerCase() ?? '';
      } catch {
        return '';
      }
    }
    return value.toLowerCase();
  })
  .pipe(z.string().regex(/^0x[0-9a-f]{40}$/, 'Adresse EVM ou URL de profil DeBank invalide.'));

// Only the documented public portfolio API is used. Never forward its error bodies or key.
export class DeBankError extends Error {
  constructor(public code: string) {
    super(`DeBank: ${code}`);
  }
}
const number = z
  .number()
  .finite()
  .refine((v) => Math.abs(v) < 1e19);
const text = z.string().max(2000);
const tokenSchema = z.object({
  id: text,
  chain: text.optional(),
  name: text.nullish(),
  symbol: text.nullish(),
  optimized_symbol: text.nullish(),
  display_symbol: text.nullish(),
  amount: number,
  price: number.nonnegative(),
  is_wallet: z.boolean().optional(),
});
const totalSchema = z.object({
  total_usd_value: number,
  chain_list: z.array(z.object({ id: text, name: text, usd_value: number })).max(500),
});
const protocolSchema = z
  .array(
    z.object({
      id: text,
      name: text,
      chain: text,
      portfolio_item_list: z
        .array(
          z.object({
            name: text,
            stats: z.object({
              asset_usd_value: number,
              debt_usd_value: number,
              net_usd_value: number,
            }),
            update_at: z.number().finite().nullish(),
            detail: z
              .object({
                supply_token_list: z.array(tokenSchema).nullish(),
                reward_token_list: z.array(tokenSchema).nullish(),
                borrow_token_list: z.array(tokenSchema).nullish(),
                description: text.nullish(),
                unlock_at: z.number().finite().nullish(),
              })
              .nullish(),
          }),
        )
        .max(10000),
    }),
  )
  .max(3000);
const iso = (seconds: number | null | undefined) => {
  if (!seconds || seconds < 0 || seconds > 8.64e12) return null;
  return new Date(seconds * 1000).toISOString();
};
function token(value: z.infer<typeof tokenSchema>, chain = ''): WalletToken {
  const price = value.price > 0 ? precise(d(value.price)) : null;
  return {
    id: value.id,
    chain: value.chain || chain,
    name: value.name || value.symbol || value.id,
    symbol: value.optimized_symbol || value.display_symbol || value.symbol || 'TOKEN',
    amount: precise(d(value.amount)),
    priceUsd: price,
    valueUsd: price === null ? null : precise(d(value.amount).mul(price)),
  };
}
export function normalizeDeBank(
  totalRaw: unknown,
  tokensRaw: unknown,
  protocolsRaw: unknown,
): WalletData {
  try {
    const total = totalSchema.parse(totalRaw);
    // is_all=false excludes receipt/spam tokens upstream; the flag is an additional guard.
    const tokens = z
      .array(tokenSchema)
      .max(30000)
      .parse(tokensRaw)
      .filter((t) => t.is_wallet !== false && t.amount > 0)
      .map((t) => token(t));
    const positions: DefiPosition[] = protocolSchema.parse(protocolsRaw).flatMap((p) =>
      p.portfolio_item_list.map((item, i) => ({
        id: `${p.chain}:${p.id}:${i}`,
        protocol: p.name,
        chain: p.chain,
        kind: item.name,
        description: item.detail?.description || null,
        assetsUsd: precise(d(item.stats.asset_usd_value)),
        debtUsd: precise(d(item.stats.debt_usd_value)),
        netUsd: precise(d(item.stats.net_usd_value)),
        observedAt: iso(item.update_at),
        unlockAt: iso(item.detail?.unlock_at),
        supplies: (item.detail?.supply_token_list || []).map((t) => token(t, p.chain)),
        rewards: (item.detail?.reward_token_list || []).map((t) => token(t, p.chain)),
        borrows: (item.detail?.borrow_token_list || []).map((t) => token(t, p.chain)),
      })),
    );
    tokens.sort((a, b) => d(b.valueUsd || 0).cmp(a.valueUsd || 0));
    positions.sort((a, b) => d(b.netUsd).cmp(a.netUsd));
    const liquid = tokens.reduce((s, t) => s.add(t.valueUsd || 0), d(0));
    const defi = positions.reduce((s, p) => s.add(p.netUsd), d(0));
    return {
      totalUsd: precise(d(total.total_usd_value)),
      tokens,
      positions,
      chains: total.chain_list.map((c) => ({
        id: c.id,
        name: c.name,
        valueUsd: precise(d(c.usd_value)),
      })),
      liquidUsd: precise(liquid),
      defiUsd: precise(defi),
      debtUsd: precise(positions.reduce((s, p) => s.add(p.debtUsd), d(0))),
      rewardsUsd: precise(
        positions.flatMap((p) => p.rewards).reduce((s, t) => s.add(t.valueUsd || 0), d(0)),
      ),
      // These detail requests are not atomic. Their difference never alters the official total.
      reconciliationUsd: precise(d(total.total_usd_value).sub(liquid).sub(defi)),
    };
  } catch {
    throw new DeBankError('FORMAT');
  }
}
async function readLimited(response: Response) {
  if (!response.body) throw new DeBankError('FORMAT');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8_000_000) {
      await reader.cancel();
      throw new DeBankError('FORMAT');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new DeBankError('FORMAT');
  }
}
export async function fetchDeBank(address: string, accessKey: string): Promise<WalletData> {
  const id = addressSchema.parse(address);
  const get = async (path: string) => {
    try {
      const res = await fetch(
        `https://pro-openapi.debank.com/v1/user/${path}${path.includes('?') ? '&' : '?'}id=${id}`,
        {
          headers: { accept: 'application/json', AccessKey: accessKey },
          signal: AbortSignal.timeout(20_000),
          cache: 'no-store',
          redirect: 'error',
        },
      );
      if (!res.ok) {
        await res.body?.cancel();
        throw new DeBankError(
          res.status === 401
            ? 'AUTH'
            : [402, 403].includes(res.status)
              ? 'CREDITS'
              : res.status === 429
                ? 'RATE_LIMIT'
                : 'NETWORK',
        );
      }
      return await readLimited(res);
    } catch (error) {
      throw error instanceof DeBankError ? error : new DeBankError('NETWORK');
    }
  };
  // Sequential: an invalid key stops after one request and consumes no further requests.
  const total = await get('total_balance');
  if (!totalSchema.safeParse(total).success) throw new DeBankError('FORMAT');
  const tokens = await get('all_token_list?is_all=false');
  const protocols = await get('all_complex_protocol_list');
  return normalizeDeBank(total, tokens, protocols);
}
