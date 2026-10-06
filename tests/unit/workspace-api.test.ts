import { beforeEach, expect, it, vi } from 'vitest';
import { workspaceFixture } from '../fixtures/workspace';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
  command: vi.fn(),
  after: vi.fn(),
  owned: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/server/portfolio', () => ({ command: mocks.command }));
vi.mock('@/server/portfolio-store', () => ({ owned: mocks.owned }));
vi.mock('@/server/market', () => ({ syncMarketData: mocks.sync }));
vi.mock('@/server/auth', () => ({ auth: () => ({ api: { getSession: mocks.session } }) }));
vi.mock('@/server/portfolio-query', () => ({ getState: mocks.read }));
import { GET, PATCH } from '@/app/api/v1/[...path]/route';

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
