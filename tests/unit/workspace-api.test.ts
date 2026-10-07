import { beforeEach, expect, it, vi } from 'vitest';
import { AppError } from '@/server/errors';
import { workspaceFixture } from '../fixtures/workspace';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
  command: vi.fn(),
  after: vi.fn(),
  owned: vi.fn(),
  sync: vi.fn(),
  walletCommand: vi.fn(),
  syncWallet: vi.fn(),
}));
vi.mock('@/server/wallets', () => ({
  walletCommand: mocks.walletCommand,
  syncWallet: mocks.syncWallet,
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/server/portfolio', () => ({ command: mocks.command }));
vi.mock('@/server/portfolio-store', () => ({ owned: mocks.owned }));
vi.mock('@/server/market', () => ({ syncMarketData: mocks.sync }));
vi.mock('@/server/auth', () => ({ auth: () => ({ api: { getSession: mocks.session } }) }));
vi.mock('@/server/portfolio-query', () => ({ getState: mocks.read }));
import { GET, PATCH, POST } from '@/app/api/v1/[...path]/route';

beforeEach(() => vi.clearAllMocks());
const read = () =>
  GET(new Request('http://localhost/api/v1/state'), {
    params: Promise.resolve({ path: ['state'] }),
  });

it('refuses anonymous reads before querying portfolio data', async () => {
  mocks.session.mockResolvedValue(null);
  const response = await read();
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.read).not.toHaveBeenCalled();
});

it('scopes every read to the authenticated owner and prevents shared HTTP caching', async () => {
  mocks.read.mockResolvedValue(workspaceFixture());
  for (const id of ['owner-one', 'owner-two']) {
    mocks.session.mockResolvedValue({ user: { id, name: id } });
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.read).toHaveBeenLastCalledWith(id);
    expect((await response.json()).data.userName).toBe(id);
  }
});

it('acknowledges a committed metal edit before fetching external quotes', async () => {
  mocks.session.mockResolvedValue({ user: { id: 'owner' } });
  mocks.command.mockResolvedValue({ id: 'gold', metadata: { metalType: 'GOLD' } });
  mocks.owned.mockResolvedValue({ id: 'portfolio' });
  vi.stubEnv('APP_ORIGIN', 'http://localhost');
  const response = await PATCH(
    new Request('http://localhost/api/v1/assets/gold', {
      method: 'PATCH',
      headers: {
        origin: process.env.APP_ORIGIN!,
        'content-type': 'application/json',
        'idempotency-key': 'same-save-key',
        'if-match': '3',
      },
      body: JSON.stringify({ name: 'Gold' }),
    }),
    { params: Promise.resolve({ path: ['assets', 'gold'] }) },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { id: 'gold' } });
  expect(mocks.command).toHaveBeenCalledWith(
    'owner',
    'PATCH',
    ['assets', 'gold'],
    { name: 'Gold' },
    'same-save-key',
    '3',
  );
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.after).toHaveBeenCalledOnce();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    mocks.sync.mockRejectedValue(new Error('Quote provider timeout'));
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(mocks.sync).toHaveBeenCalledWith('portfolio');
    expect(warning).toHaveBeenCalledOnce();
  } finally {
    warning.mockRestore();
    vi.unstubAllEnvs();
  }
});

const refreshWallet = () =>
  POST(
    new Request('http://localhost/api/v1/wallets/wallet-id/sync', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
        'idempotency-key': 'manual-refresh-key',
        authorization: 'Bearer cron-secret',
      },
      body: '{}',
    }),
    { params: Promise.resolve({ path: ['wallets', 'wallet-id', 'sync'] }) },
  );
it('requires a user session, not CRON_SECRET, for a manual wallet refresh', async () => {
  vi.stubEnv('APP_ORIGIN', 'http://localhost');
  mocks.session.mockResolvedValue(null);
  expect((await refreshWallet()).status).toBe(401);
  expect(mocks.walletCommand).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
it('schedules the shared wallet service only after the owner-scoped command commits', async () => {
  vi.stubEnv('APP_ORIGIN', 'http://localhost');
  mocks.session.mockResolvedValue({ user: { id: 'owner' } });
  mocks.walletCommand.mockResolvedValue({ id: 'wallet-id', queued: true });
  mocks.syncWallet.mockResolvedValue(true);
  expect((await refreshWallet()).status).toBe(200);
  expect(mocks.walletCommand).toHaveBeenCalledWith(
    'owner',
    'POST',
    ['wallets', 'wallet-id', 'sync'],
    {},
    'manual-refresh-key',
  );
  expect(mocks.syncWallet).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0][0]();
  expect(mocks.syncWallet).toHaveBeenCalledWith('wallet-id');
  vi.unstubAllEnvs();
});
it('does not schedule a wallet rejected by ownership checks', async () => {
  vi.stubEnv('APP_ORIGIN', 'http://localhost');
  mocks.session.mockResolvedValue({ user: { id: 'attacker' } });
  mocks.walletCommand.mockRejectedValue(new AppError('NOT_FOUND', 'Wallet introuvable.', 404));
  expect((await refreshWallet()).status).toBe(404);
  expect(mocks.after).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
