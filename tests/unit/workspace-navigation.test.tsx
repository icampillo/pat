import { beforeEach, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppState } from '@/shared/types';
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
  read: vi.fn(() => {
    throw new Error('Unexpected portfolio reload during navigation');
  }),
}));
vi.mock('@/app/(private)/_data', () => ({ getPrivateData: mocks.read }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
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
const state = {
  portfolio: { displayCurrency: 'EUR', version: 1 },
  categories: [{ id: 'crypto-id', key: 'CRYPTO', label: 'Crypto', color: '#6556dc' }],
} as AppState;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = '';
  mocks.slug = 'crypto';
});

it.each([Dashboard, Portfolio, Wallets, Settings, Activity, Category, NewAsset, NewTransaction])(
  'renders a route from the shared state, including refreshed layout props',
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
    expect(mocks.read).not.toHaveBeenCalled();
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

it('still refreshes the authenticated layout after a successful mutation', async () => {
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
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: 'saved' } }) }),
  );
  try {
    await expect(workspace!.save('settings', 'PATCH', { name: 'Updated' })).resolves.toEqual({
      id: 'saved',
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('refreshes old data without making each page wait for a portfolio reload', () => {
  for (const age of [0, 59_000, 61_000]) {
    mocks.refresh.mockClear();
    const current = { ...state, asOf: new Date(Date.now() - age).toISOString() };
    renderToStaticMarkup(
      <WorkspaceProvider state={current}>
        <Dashboard />
      </WorkspaceProvider>,
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
    const effect = vi.mocked(useEffect).mock.lastCall![0];
    effect();
    expect(mocks.refresh).toHaveBeenCalledTimes(age >= 60_000 ? 1 : 0);
  }
});
