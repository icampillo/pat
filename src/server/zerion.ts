import { z } from 'zod';
import { decimal as d, precise } from '@/domain/money';
import type { DefiPosition, WalletData, WalletToken } from '@/shared/wallets';

export const addressSchema = z
  .string()
  .trim()
  .transform((value) => {
    // Old pasted DeBank profile URLs remain accepted; no request is made to DeBank.
    const match = value.match(
      /^https:\/\/(?:www\.)?debank\.com\/profile\/(0x[0-9a-f]{40})(?:[/?#].*)?$/i,
    );
    return (match?.[1] || value).toLowerCase();
  })
  .pipe(z.string().regex(/^0x[0-9a-f]{40}$/, 'Adresse publique EVM invalide.'));

export class ZerionError extends Error {
  constructor(
    public code: string,
    public retryAfterMs = 0,
  ) {
    super(`Zerion: ${code}`);
  }
}
export function zerionConfigured() {
  return !!process.env.ZERION_API_KEY?.trim();
}
const text = z.string().max(2000);
const money = z
  .union([z.number().finite(), z.string().regex(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i)])
  .refine((v) => d(v).isFinite() && d(v).abs().lt('1e19'))
  .transform(String);
const positive = money.refine((v) => d(v).gte(0));
const info = z.object({
  name: text.nullish(),
  symbol: text.nullish(),
  implementations: z
    .array(z.object({ chain_id: text, address: text.nullish() }))
    .max(500)
    .optional(),
});
const positionSchema = z.object({
  id: text.min(1),
  type: z.literal('positions'),
  attributes: z.object({
    name: text,
    position_type: text.min(1),
    protocol: text.nullish(),
    protocol_module: text.nullish(),
    group_id: text.nullish(),
    parent: text.nullish(),
    quantity: z.object({
      numeric: positive,
      int: z.string().regex(/^\d+$/),
      decimals: z.coerce.number().int().min(0).max(255),
    }),
    encrypted_quantity: z.object({ handle: text }).nullish(),
    value: positive.nullable(),
    price: positive.nullish(),
    fungible_info: info.nullish(),
    receipt: z.object({ fungible_info: info.nullish() }).nullish(),
    flags: z.object({ displayable: z.boolean(), is_trash: z.boolean().optional() }),
    updated_at: z.iso.datetime({ offset: true }).nullish(),
  }),
  relationships: z.object({ chain: z.object({ data: z.object({ id: text.min(1) }) }) }),
});
const envelope = { errors: z.array(z.unknown()).max(0).optional() };
const portfolioSchema = z.object({
  ...envelope,
  data: z.object({
    type: z.literal('portfolio'),
    id: text,
    attributes: z.object({
      total: z.object({ positions: money }),
      positions_distribution_by_chain: z.record(text, money),
      positions_distribution_by_type: z.record(text, money).optional(),
    }),
  }),
});
const pageSchema = z.object({
  ...envelope,
  data: z.array(positionSchema).max(30000),
  links: z.object({ next: z.string().nullable().optional() }).optional(),
});
type Position = z.infer<typeof positionSchema>;
const kinds: Record<string, string> = {
  deposit: 'Deposit',
  loan: 'Lending',
  staked: 'Staked',
  locked: 'Locked',
  reward: 'Rewards',
  investment: 'Yield',
};
const modules: Record<string, string> = {
  lending: 'Lending',
  liquidity_pool: 'Liquidity Pool',
  yield: 'Yield',
  farming: 'Farming',
  vesting: 'Vesting',
};
const sumTokens = (tokens: WalletToken[]) => tokens.reduce((s, t) => s.add(t.valueUsd ?? 0), d(0));
function contractKeys(p: Position, receipt = false) {
  const chain = p.relationships.chain.data.id;
  const asset = receipt ? p.attributes.receipt?.fungible_info : p.attributes.fungible_info;
  return (asset?.implementations || [])
    .filter((i) => i.chain_id === chain && i.address)
    .map((i) => `${chain}:${i.address!.toLowerCase()}`);
}

export function normalizeZerion(portfolioRaw: unknown, pagesRaw: unknown[]): WalletData {
  try {
    const portfolio = portfolioSchema.parse(portfolioRaw).data.attributes;
    const rows = pagesRaw.flatMap((page) => pageSchema.parse(page).data);
    const unique = new Map<string, Position>();
    for (const row of rows) {
      const prior = unique.get(row.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(row))
        throw new ZerionError('INCOMPLETE');
      unique.set(row.id, row);
    }
    const receipts = new Set(
      [...unique.values()]
        .filter((p) => p.attributes.position_type !== 'wallet' && p.attributes.flags.displayable)
        .flatMap((p) => contractKeys(p, true)),
    );
    const warnings: string[] = [];
    const tokens: WalletToken[] = [];
    const groups = new Map<string, DefiPosition>();
    const excludedPositionIds: string[] = [];
    for (const p of unique.values()) {
      const a = p.attributes,
        chain = p.relationships.chain.data.id;
      if (
        !a.flags.displayable ||
        (a.position_type === 'wallet' && contractKeys(p).some((key) => receipts.has(key)))
      ) {
        excludedPositionIds.push(p.id);
        continue;
      }
      const t: WalletToken = {
        id: p.id,
        chain,
        name: a.fungible_info?.name || a.name,
        symbol: a.fungible_info?.symbol || 'TOKEN',
        amount: a.encrypted_quantity ? null : a.quantity.numeric,
        priceUsd: a.price ?? null,
        valueUsd: a.encrypted_quantity ? null : a.value,
      };
      if (t.valueUsd === null)
        warnings.push(
          `${chain} · ${t.symbol} (${p.id}) : position non valorisée${a.encrypted_quantity ? ', quantité confidentielle' : ''}.`,
        );
      if (a.position_type === 'wallet') {
        tokens.push(t);
        continue;
      }
      if (!kinds[a.position_type])
        warnings.push(
          `${chain} · ${a.protocol || a.name} : type non pris en charge (${a.position_type}).`,
        );
      // Never sum receipt amounts, parent metadata or rewards a second time.
      const id = `${chain}:${a.protocol || 'unknown'}:${a.group_id || p.id}`;
      let group = groups.get(id);
      if (!group) {
        group = {
          id,
          protocol: a.protocol || 'Protocole inconnu',
          chain,
          kind: modules[a.protocol_module || ''] || kinds[a.position_type] || a.position_type,
          description: a.name,
          assetsUsd: '0',
          debtUsd: '0',
          netUsd: '0',
          observedAt: a.updated_at || null,
          unlockAt: null,
          supplies: [],
          rewards: [],
          borrows: [],
        };
        groups.set(id, group);
      }
      if (a.updated_at && (!group.observedAt || a.updated_at < group.observedAt))
        group.observedAt = a.updated_at;
      if (!kinds[a.position_type] || t.valueUsd === null) group.approximate = true;
      if (a.position_type === 'loan') group.borrows.push(t);
      else if (a.position_type === 'reward') group.rewards.push(t);
      else group.supplies.push(t);
    }
    const positions = [...groups.values()].map((p) => {
      const assets = sumTokens(p.supplies).add(sumTokens(p.rewards)),
        debt = sumTokens(p.borrows);
      return {
        ...p,
        assetsUsd: precise(assets),
        debtUsd: precise(debt),
        netUsd: precise(assets.sub(debt)),
      };
    });
    const liquid = sumTokens(tokens),
      defi = positions.reduce((s, p) => s.add(p.netUsd), d(0));
    const total = d(portfolio.total.positions),
      reconciliation = total.sub(liquid).sub(defi);
    const chains = Object.entries(portfolio.positions_distribution_by_chain).map(
      ([id, valueUsd]) => ({ id, name: id, valueUsd }),
    );
    // The consolidated response itself must be coherent. Never replace an error/empty detail with zero.
    if (
      total
        .sub(chains.reduce((s, c) => s.add(c.valueUsd), d(0)))
        .abs()
        .gt(d('0.01').add(total.abs().mul('0.000001')))
    )
      throw new ZerionError('INCOMPLETE');
    if (!tokens.length && !positions.length && !total.isZero()) throw new ZerionError('INCOMPLETE');
    if (reconciliation.abs().gte('0.01'))
      warnings.push(
        `Écart de réconciliation : ${precise(reconciliation)} USD (total consolidé moins détails nets).`,
      );
    return {
      source: 'ZERION',
      quality: warnings.length ? 'partial' : 'complete',
      warnings,
      totalUsd: precise(total),
      tokens,
      positions,
      chains,
      liquidUsd: precise(liquid),
      defiUsd: precise(defi),
      debtUsd: precise(positions.reduce((s, p) => s.add(p.debtUsd), d(0))),
      rewardsUsd: precise(positions.reduce((s, p) => s.add(sumTokens(p.rewards)), d(0))),
      reconciliationUsd: precise(reconciliation),
      excludedPositionIds,
    };
  } catch (error) {
    throw error instanceof ZerionError ? error : new ZerionError('FORMAT');
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function retryAfterMs(headers: Headers, now = Date.now()) {
  const value = headers.get('Retry-After');
  if (value) {
    const seconds = Number(value);
    return Math.max(
      0,
      Number.isFinite(seconds) ? seconds * 1000 : (Date.parse(value) || now) - now,
    );
  }
  return Math.max(0, Number(headers.get('RateLimit-Org-Second-Reset')) || 0) * 1000;
}
async function readJson(response: Response) {
  if (!response.body) throw new ZerionError('FORMAT');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8_000_000) {
      await reader.cancel();
      throw new ZerionError('FORMAT');
    }
    chunks.push(value);
  }
  try {
    // Node 24's JSON source context preserves monetary literals before IEEE-754 rounding.
    return JSON.parse(
      Buffer.concat(chunks).toString('utf8'),
      (_key, value, context?: { source: string }) =>
        typeof value === 'number' ? (context?.source ?? String(value)) : value,
    ) as unknown;
  } catch {
    throw new ZerionError('FORMAT');
  }
}

export async function fetchZerion(
  address: string,
  options: {
    fetch?: typeof fetch;
    reserve?: (advanced: boolean) => Promise<void>;
    wait?: typeof sleep;
    random?: () => number;
  } = {},
): Promise<WalletData> {
  const id = addressSchema.parse(address),
    key = process.env.ZERION_API_KEY?.trim();
  if (!key || /[\r\n:]/.test(key)) throw new ZerionError('KEY');
  const reserve = options.reserve || (await import('./zerion-budget')).reserveZerionRequest;
  const wait = options.wait || sleep,
    deadline = Date.now() + 90_000;
  const base = `https://api.zerion.io/v1/wallets/${id}/`;
  const get = async (url: string, advanced: boolean) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() >= deadline) throw new ZerionError('TIMEOUT');
      await reserve(advanced);
      let failure: ZerionError;
      try {
        const res = await (options.fetch || fetch)(url, {
          headers: {
            accept: 'application/json',
            authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
          },
          signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now()))),
          redirect: 'error',
          cache: 'no-store',
        });
        if (res.ok) return await readJson(res);
        const retry = retryAfterMs(res.headers);
        const exhausted = ['Day', 'Month'].some(
          (period) => res.headers.get(`RateLimit-Org-${period}-Remaining`) === '0',
        );
        await res.body?.cancel();
        failure = new ZerionError(
          res.status === 400
            ? 'BAD_REQUEST'
            : res.status === 401
              ? 'AUTH'
              : [402, 403].includes(res.status)
                ? 'ACCESS'
                : res.status === 429
                  ? exhausted
                    ? 'QUOTA'
                    : 'RATE_LIMIT'
                  : res.status >= 500
                    ? 'SERVER'
                    : 'BAD_REQUEST',
          retry,
        );
      } catch (error) {
        failure =
          error instanceof ZerionError
            ? error
            : new ZerionError(
                error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
                  ? 'TIMEOUT'
                  : 'NETWORK',
              );
      }
      if (!['RATE_LIMIT', 'SERVER', 'NETWORK', 'TIMEOUT'].includes(failure.code) || attempt === 2)
        throw failure;
      const delay = Math.max(
        failure.retryAfterMs,
        500 * 2 ** attempt + (options.random || Math.random)() * 250,
      );
      if (delay > 10_000 || Date.now() + delay + 1000 >= deadline) throw failure;
      await wait(delay);
    }
    throw new ZerionError('NETWORK');
  };
  const portfolio = await get(`${base}portfolio?filter[positions]=no_filter&currency=usd`, false);
  if (!portfolioSchema.safeParse(portfolio).success) throw new ZerionError('FORMAT');
  if (portfolioSchema.parse(portfolio).data.id.toLowerCase() !== id)
    throw new ZerionError('FORMAT');
  const pages: unknown[] = [],
    seen = new Set<string>();
  let next: string | null = `${base}positions/?filter[positions]=no_filter&currency=usd`;
  // Currently not paginated (official schema, 2026-10-08). Honor future next links safely.
  while (next) {
    const url: URL = new URL(next, base);
    if (
      url.origin !== 'https://api.zerion.io' ||
      url.pathname !== `/v1/wallets/${id}/positions/` ||
      url.username ||
      url.password ||
      url.hash ||
      seen.has(url.href) ||
      pages.length >= 30
    )
      throw new ZerionError('PAGINATION');
    url.searchParams.set('filter[positions]', 'no_filter');
    url.searchParams.set('currency', 'usd');
    if (seen.has(url.href)) throw new ZerionError('PAGINATION');
    seen.add(url.href);
    const raw = await get(url.href, true),
      parsed = pageSchema.safeParse(raw);
    if (!parsed.success) throw new ZerionError('FORMAT');
    pages.push(raw);
    next = parsed.data.links?.next || null;
  }
  return normalizeZerion(portfolio, pages);
}
