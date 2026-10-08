import 'dotenv/config';
import { configureTestDatabase } from '../database-env';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db';
import { marketQuote } from '@/server/market-cache';

configureTestDatabase();
beforeAll(() => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  });
});
afterAll(async () => {
  await db().$disconnect();
});
const quote = { price: '42', observedAt: '2026-10-08T12:00:00.000Z' };

it('shares a single provider attempt and result across concurrent serverless callers', async () => {
  const key = randomUUID();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = vi.fn(async () => {
    await gate;
    return quote;
  });
  const first = marketQuote(key, provider);
  await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
  const others = Array.from({ length: 5 }, () => marketQuote(key, provider));
  release();
  expect(await Promise.all([first, ...others])).toEqual(Array(6).fill(quote));
  expect(provider).toHaveBeenCalledOnce();
  expect(await marketQuote(key, provider)).toEqual(quote);
  expect(provider).toHaveBeenCalledOnce();
});

it('retries after five minutes even if the provider returns an unchanged/old quote date', async () => {
  const key = randomUUID();
  const provider = vi.fn(async () => quote);
  await marketQuote(key, provider);
  await db().marketQuoteCache.update({
    where: { key },
    data: { lastAttemptAt: new Date(Date.now() - 299_000) },
  });
  await marketQuote(key, provider);
  expect(provider).toHaveBeenCalledOnce();
  await db().marketQuoteCache.update({
    where: { key },
    data: { lastAttemptAt: new Date(Date.now() - 301_000) },
  });
  await marketQuote(key, provider);
  await marketQuote(key, provider);
  expect(provider).toHaveBeenCalledTimes(2);
});

it('counts failed attempts, preserves cached data and never leaks provider errors', async () => {
  const key = randomUUID();
  await marketQuote(key, async () => quote);
  await db().marketQuoteCache.update({ where: { key }, data: { lastAttemptAt: new Date(0) } });
  const provider = vi.fn(async () => {
    throw new Error('private provider details');
  });
  await expect(marketQuote(key, provider)).rejects.toThrow('MARKET_QUOTE_UNAVAILABLE');
  await expect(marketQuote(key, provider)).rejects.toThrow('MARKET_QUOTE_UNAVAILABLE');
  expect(provider).toHaveBeenCalledOnce();
  expect(await db().marketQuoteCache.findUniqueOrThrow({ where: { key } })).toMatchObject({
    data: quote,
    failed: true,
    leaseToken: null,
  });
});

it('recovers a killed Function only after cooldown and keeps distinct listings independent', async () => {
  const key = randomUUID();
  await db().marketQuoteCache.create({
    data: { key, lastAttemptAt: new Date(), leaseToken: 'dead', leaseUntil: new Date(0) },
  });
  const provider = vi.fn(async () => quote);
  await expect(marketQuote(key, provider)).rejects.toThrow('MARKET_QUOTE_PENDING');
  expect(provider).not.toHaveBeenCalled();
  expect(await marketQuote(randomUUID(), provider)).toEqual(quote);
  await db().marketQuoteCache.update({ where: { key }, data: { lastAttemptAt: new Date(0) } });
  expect(await marketQuote(key, provider)).toEqual(quote);
  expect(provider).toHaveBeenCalledTimes(2);
});

it('fences a stale owner so it cannot overwrite a replacement or release its lease', async () => {
  const key = randomUUID();
  const provider = async () => {
    await db().marketQuoteCache.update({
      where: { key },
      data: { leaseToken: 'replacement', data: { price: '99' } },
    });
    return quote;
  };
  await expect(marketQuote(key, provider)).rejects.toThrow('MARKET_QUOTE_UNAVAILABLE');
  expect(await db().marketQuoteCache.findUniqueOrThrow({ where: { key } })).toMatchObject({
    leaseToken: 'replacement',
    data: { price: '99' },
  });
});
