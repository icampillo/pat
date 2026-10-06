import { beforeEach, expect, it, vi } from 'vitest';
import { workspaceFixture } from '../fixtures/workspace';

const mocks = vi.hoisted(() => ({ session: vi.fn(), read: vi.fn() }));
vi.mock('@/server/auth', () => ({ auth: () => ({ api: { getSession: mocks.session } }) }));
vi.mock('@/server/portfolio-query', () => ({ getState: mocks.read }));
import { GET } from '@/app/api/v1/[...path]/route';

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
