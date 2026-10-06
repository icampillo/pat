import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { workspaceFixture } from '../fixtures/workspace';
import { WorkspaceProvider, useWorkspace } from '@/components/workspace/context';
import Dashboard from '@/app/(private)/dashboard/page';
import Portfolio from '@/app/(private)/portfolio/page';
import Wallets from '@/app/(private)/wallets/page';
import Settings from '@/app/(private)/settings/page';
import Activity from '@/app/(private)/activity/page';
import Category from '@/app/(private)/categories/[slug]/page';
import NewAsset from '@/app/(private)/assets/new/page';
import NewTransaction from '@/app/(private)/transactions/new/page';

const mocks = vi.hoisted(() => ({
  query: '',
  slug: 'crypto',
  refresh: vi.fn(),
  render: vi.fn(() => null),
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
}));
vi.mock('next/link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/link')>()),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams(mocks.query),
  useParams: () => ({ slug: mocks.slug }),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/components/pages/dashboard', () => ({ DashboardPage: mocks.render }));
vi.mock('@/components/pages/portfolio', () => ({ PortfolioPage: mocks.render }));
vi.mock('@/components/pages/wallets', () => ({ WalletsRoutePage: mocks.render }));
vi.mock('@/components/pages/settings', () => ({ SettingsPage: mocks.render }));
vi.mock('@/components/pages/history', () => ({ HistoryPage: mocks.render }));
vi.mock('@/components/pages/transactions', () => ({
  TransactionsPage: mocks.render,
  TransactionEditorPage: mocks.render,
}));
vi.mock('@/components/pages/category', () => ({ CategoryRoutePage: mocks.render }));
vi.mock('@/components/pages/assets', () => ({ NewAssetPage: mocks.render }));

// Only route plumbing is exercised; page bodies are replaced by a prop observer.
const state = workspaceFixture();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = '';
  mocks.slug = 'crypto';
});

it.each([Dashboard, Portfolio, Wallets, Settings, Activity, Category, NewAsset, NewTransaction])(
  'renders a route from the shared state, including a newer initial snapshot',
  (Page) => {
    for (const current of [state, { ...state, portfolio: { ...state.portfolio, version: 2 } }]) {
      renderToStaticMarkup(
        <WorkspaceProvider state={current}>
          <Page />
        </WorkspaceProvider>,
      );
      expect(mocks.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ state: current }),
        undefined,
      );
    }
  },
);

it('preserves category selection, unknown-category rejection and activity query parameters', () => {
  mocks.query = 'category=CRYPTO';
  renderToStaticMarkup(
    <WorkspaceProvider state={state}>
      <NewAsset />
    </WorkspaceProvider>,
  );
  expect(mocks.render).toHaveBeenLastCalledWith(
    expect.objectContaining({ initialCategory: 'crypto-id' }),
    undefined,
  );
  renderToStaticMarkup(
    <WorkspaceProvider state={state}>
      <Category />
    </WorkspaceProvider>,
  );
  expect(mocks.render).toHaveBeenLastCalledWith(
    expect.objectContaining({ categoryId: 'crypto-id' }),
    undefined,
  );
  mocks.slug = 'missing';
  expect(() =>
    renderToStaticMarkup(
      <WorkspaceProvider state={state}>
        <Category />
      </WorkspaceProvider>,
    ),
  ).toThrow('NOT_FOUND');
  mocks.query = 'view=history';
  const html = renderToStaticMarkup(
    <WorkspaceProvider state={state}>
      <Activity />
    </WorkspaceProvider>,
  );
  expect(html).toContain('aria-current="page" href="/activity?view=history"');
});

it('revalidates data after a successful mutation without invalidating the route cache', async () => {
  let workspace: ReturnType<typeof useWorkspace>;
  function Probe() {
    workspace = useWorkspace();
    return null;
  }
  renderToStaticMarkup(
    <WorkspaceProvider state={state}>
      <Probe />
    </WorkspaceProvider>,
  );
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'saved' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: state }) }),
  );
  try {
    await expect(workspace!.save('settings', 'PATCH', { name: 'Updated' })).resolves.toEqual({
      id: 'saved',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/state',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each(['assets/asset-id', 'transactions/transaction-id'])(
  'keeps the same idempotency key after a non-JSON save failure on %s',
  async (route) => {
    let workspace: ReturnType<typeof useWorkspace>;
    function Probe() {
      workspace = useWorkspace();
      return null;
    }
    renderToStaticMarkup(
      <WorkspaceProvider state={state}>
        <Probe />
      </WorkspaceProvider>,
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('An error occurred', { status: 504 }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'saved' } }))
      .mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 502 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(workspace!.save(route, 'PATCH', { name: 'Updated' }, 2)).rejects.toThrow(
        'Confirmation d’enregistrement indisponible',
      );
      await expect(workspace!.save(route, 'PATCH', { name: 'Updated' }, 2)).resolves.toEqual({
        id: 'saved',
      });
      expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toBe(
        fetcher.mock.calls[1][1].headers['Idempotency-Key'],
      );
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
