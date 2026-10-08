import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addressSchema,
  fetchZerion,
  normalizeZerion,
  retryAfterMs,
  zerionConfigured,
} from '@/server/zerion';
import { address, portfolio, position, fluidPositions } from '../fixtures/zerion';
const parse = (rows = fluidPositions(), total = portfolio()) => normalizeZerion(total, [rows]);
const reserve = vi.fn(async () => {}),
  wait = vi.fn(async () => {});
function options(mock: ReturnType<typeof vi.fn>) {
  return { fetch: mock as typeof fetch, reserve, wait, random: () => 0 };
}
beforeEach(() => {
  vi.stubEnv('ZERION_API_KEY', 'test-only-key');
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Zerion financial contract', () => {
  it('preserves the official net total and precise quantities for Fluid ETH/stETH collateral, USDC debt and rewards', () => {
    const data = parse();
    expect(data).toMatchObject({
      source: 'ZERION',
      quality: 'complete',
      totalUsd: '905',
      liquidUsd: '100',
      defiUsd: '805',
      debtUsd: '200',
      rewardsUsd: '5',
      reconciliationUsd: '0',
    });
    expect(data.positions).toHaveLength(1);
    expect(data.positions[0]).toMatchObject({
      protocol: 'Fluid',
      assetsUsd: '1005',
      debtUsd: '200',
      netUsd: '805',
    });
    expect(data.positions[0].supplies[0].amount).toBe('1.234567890123456789');
  });
  it('deduplicates receipts by chain AND contract, ignores non-displayable rows but keeps both LP legs', () => {
    const receipt = position('receipt');
    const deposit = {
      ...position('deposit', 'deposit', 50, 'ETH', 'lp'),
      attributes: {
        ...position('deposit', 'deposit', 50, 'ETH', 'lp').attributes,
        receipt: { fungible_info: receipt.attributes.fungible_info },
      },
    };
    const hidden = position('hidden');
    hidden.attributes.flags.displayable = false;
    const otherChain = position('receipt-other-chain');
    otherChain.relationships.chain.data.id = 'base';
    otherChain.attributes.fungible_info.implementations = [
      { chain_id: 'base', address: '0xreceipt' },
    ];
    const data = parse(
      {
        data: [receipt, deposit, position('lp2', 'deposit', 50, 'USDC', 'lp'), hidden, otherChain],
      },
      portfolio(200),
    );
    expect(data.excludedPositionIds).toEqual(['receipt', 'hidden']);
    expect(data.tokens).toHaveLength(1);
    expect(data.positions[0].supplies).toHaveLength(2);
    expect(data.reconciliationUsd).toBe('0');
  });
  it.each(['staked', 'locked', 'investment', 'deposit'])(
    'supports %s without assuming optional receipt/protocol info',
    (type) => {
      const row = position(type, type, 10);
      row.attributes.protocol = null;
      expect(parse({ data: [row] }, portfolio(10)).positions[0].netUsd).toBe('10');
    },
  );
  it('allows a validated empty wallet, and negative equity', () => {
    expect(parse({ data: [] }, portfolio(0)).totalUsd).toBe('0');
    expect(parse({ data: [position('debt', 'loan', 12)] }, portfolio(-12)).totalUsd).toBe('-12');
  });
  it('marks unpriced tokens and unknown position types partial, never prices them at zero', () => {
    const data = parse(
      { data: [position('unknown', 'wallet', null), position('new', 'unknown-type', 10)] },
      portfolio(10),
    );
    expect(data.quality).toBe('partial');
    expect(data.tokens[0].valueUsd).toBeNull();
    expect(data.warnings?.join(' ')).toMatch(/non valorisée/);
    expect(data.warnings?.join(' ')).toMatch(/non pris en charge/);
  });
  it('encrypted quantity zero placeholders do not become measured zero', () => {
    const row = position('encrypted', 'wallet', null);
    const data = normalizeZerion(portfolio(0), [
      {
        data: [
          { ...row, attributes: { ...row.attributes, encrypted_quantity: { handle: 'opaque' } } },
        ],
      },
    ]);
    expect(data.tokens[0].amount).toBeNull();
    expect(data.quality).toBe('partial');
  });
  it('retains and exposes residuals instead of manufacturing a token to balance them', () => {
    const data = parse(fluidPositions(), portfolio(908));
    expect(data.reconciliationUsd).toBe('3');
    expect(data.totalUsd).toBe('908');
    expect(data.quality).toBe('partial');
    expect(data.tokens).toHaveLength(1);
  });
  it('rejects incomplete envelopes, missing values, errors in 200, incoherent totals and conflicting duplicate IDs', () => {
    for (const raw of [{}, { errors: ['partial'], ...portfolio() }, portfolio(null as never)])
      expect(() => normalizeZerion(raw, [fluidPositions()])).toThrow('FORMAT');
    expect(() => normalizeZerion(portfolio(), [{ data: [{ id: 'broken' }] }])).toThrow('FORMAT');
    expect(() => parse({ data: [] })).toThrow('INCOMPLETE');
    const raw = portfolio();
    raw.data.attributes.positions_distribution_by_chain.ethereum = 1;
    expect(() => parse(fluidPositions(), raw)).toThrow('INCOMPLETE');
    expect(() => parse({ data: [position('x'), position('x', 'wallet', 123)] })).toThrow(
      'INCOMPLETE',
    );
  });
});

describe('Zerion HTTP transport', () => {
  it('validates configuration before any request', async () => {
    vi.stubEnv('ZERION_API_KEY', '');
    const mock = vi.fn();
    expect(zerionConfigured()).toBe(false);
    await expect(fetchZerion(address, options(mock))).rejects.toThrow('KEY');
    expect(mock).not.toHaveBeenCalled();
    expect(addressSchema.parse(address.toUpperCase())).toBe(address);
    expect(addressSchema.parse(`https://debank.com/profile/${address}`)).toBe(address);
    expect(addressSchema.safeParse(`https://debank.com.evil.test/profile/${address}`).success).toBe(
      false,
    );
  });
  it('uses Basic key: only server-side, no redirects, two official requests and exact decimal JSON literals', async () => {
    const raw = JSON.stringify(portfolio()).replaceAll('905', '905.123456789012345678');
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response(raw))
      .mockResolvedValueOnce(Response.json(fluidPositions()));
    const data = await fetchZerion(address, options(mock));
    expect(data.totalUsd).toBe('905.123456789012345678');
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[0][1]).toMatchObject({
      headers: { authorization: `Basic ${Buffer.from('test-only-key:').toString('base64')}` },
      redirect: 'error',
      cache: 'no-store',
    });
    for (const call of mock.mock.calls) {
      const url = new URL(call[0]);
      expect(url.searchParams.get('filter[positions]')).toBe('no_filter');
      expect(url.searchParams.get('currency')).toBe('usd');
    }
    expect(reserve.mock.calls).toEqual([[false], [true]]);
    expect(JSON.stringify(data)).not.toContain('test-only-key');
  });
  it('follows all pages, deduplicates repeated IDs and counts every page', async () => {
    const all = fluidPositions().data;
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(portfolio()))
      .mockResolvedValueOnce(
        Response.json({
          data: all.slice(0, 2),
          links: {
            next: `https://api.zerion.io/v1/wallets/${address}/positions/?page[after]=next`,
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: all.slice(1), links: { next: null } }));
    expect((await fetchZerion(address, options(mock))).totalUsd).toBe('905');
    expect(mock).toHaveBeenCalledTimes(3);
    expect(reserve.mock.calls).toEqual([[false], [true], [true]]);
  });
  it.each([
    'https://evil.test/steal',
    `https://api.zerion.io/v1/wallets/${address}/portfolio`,
    `https://api.zerion.io/v1/wallets/${address}/positions/?filter[positions]=no_filter&currency=usd`,
  ])('rejects unsafe or cyclic next link %s', async (next) => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(portfolio()))
      .mockResolvedValueOnce(Response.json({ ...fluidPositions(), links: { next } }));
    await expect(fetchZerion(address, options(mock))).rejects.toThrow('PAGINATION');
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it.each([
    [400, 'BAD_REQUEST', 1],
    [401, 'AUTH', 1],
    [403, 'ACCESS', 1],
    [429, 'RATE_LIMIT', 3],
    [500, 'SERVER', 3],
  ])('isolates HTTP %i and never returns upstream bodies', async (status, code, calls) => {
    const mock = vi
      .fn()
      .mockImplementation(
        async () => new Response('sensitive upstream body', { status: Number(status) }),
      );
    await expect(fetchZerion(address, options(mock))).rejects.toMatchObject({
      code,
      message: `Zerion: ${code}`,
    });
    expect(mock).toHaveBeenCalledTimes(calls);
  });
  it('honors Retry-After, exponential backoff and daily quota exhaustion', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(Response.json(portfolio()))
      .mockResolvedValueOnce(Response.json(fluidPositions()));
    await fetchZerion(address, options(mock));
    expect(wait).toHaveBeenCalledWith(2000);
    expect(
      retryAfterMs(
        new Headers({ 'Retry-After': 'Thu, 01 Oct 2026 00:00:10 GMT' }),
        Date.parse('2026-10-01T00:00:00Z'),
      ),
    ).toBe(10000);
    const exhausted = vi
      .fn()
      .mockResolvedValue(
        new Response('', { status: 429, headers: { 'RateLimit-Org-Day-Remaining': '0' } }),
      );
    await expect(fetchZerion(address, options(exhausted))).rejects.toThrow('QUOTA');
    expect(exhausted).toHaveBeenCalledTimes(1);
    const long = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    await expect(fetchZerion(address, options(long))).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      retryAfterMs: 120000,
    });
    expect(long).toHaveBeenCalledTimes(1);
  });
  it('retries network/timeouts with bounded exponential backoff and sanitized errors', async () => {
    for (const failure of [new Error('secret URL'), new DOMException('secret', 'TimeoutError')]) {
      const mock = vi.fn().mockRejectedValue(failure);
      wait.mockClear();
      await expect(fetchZerion(address, options(mock))).rejects.toMatchObject({
        code: failure.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK',
      });
      expect(wait.mock.calls).toEqual([[500], [1000]]);
      expect(mock).toHaveBeenCalledTimes(3);
    }
  });
  it('does not publish a portfolio when a later detail page is invalid', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(portfolio()))
      .mockResolvedValueOnce(Response.json({ errors: ['partial'] }));
    await expect(fetchZerion(address, options(mock))).rejects.toThrow('FORMAT');
  });
});
