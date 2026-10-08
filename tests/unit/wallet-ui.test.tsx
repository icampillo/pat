import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WalletConnectionCard } from '@/components/wallets/connection-card';
import { WalletPositions } from '@/components/wallets/positions';
import { ZerionSettings } from '@/components/wallets/zerion-settings';
import { workspaceFixture } from '../fixtures/workspace';
import { historicalDeBank } from '../fixtures/debank-history';
import { normalizeZerion } from '@/server/zerion';
import { portfolio, fluidPositions } from '../fixtures/zerion';
import { compareWalletCoverage } from '@/server/wallet-coverage';
function fixture() {
  const state = workspaceFixture();
  state.onchain.wallets = [
    {
      id: 'wallet',
      address: `0x${'a'.repeat(40)}`,
      label: 'Personnel',
      enabled: true,
      included: true,
      status: 'OK',
      errorCode: null,
      stale: false,
      lastSuccessAt: '2026-10-08T00:00:00Z',
      nextSyncAt: '2026-10-09T00:00:00Z',
      referenceUsd: null,
      referenceAt: null,
      data: historicalDeBank,
    },
  ];
  return state;
}
it('renders historical DeBank provenance without relabeling it Zerion', () => {
  const state = fixture();
  const html = renderToStaticMarkup(
    <WalletConnectionCard
      wallet={state.onchain.wallets[0]}
      config={state.onchain.config}
      busy={false}
      save={vi.fn()}
      run={vi.fn()}
    />,
  );
  expect(html).toContain('DeBank (historique)');
  expect(html).toContain('Dernière réussite');
});
it('renders preserved errors, partial details and explicit reconciliation', () => {
  const state = fixture();
  state.onchain.wallets[0].data = normalizeZerion(portfolio(908), [fluidPositions()]);
  state.onchain.wallets[0].status = 'PARTIAL';
  const html = renderToStaticMarkup(
    <WalletConnectionCard
      wallet={state.onchain.wallets[0]}
      config={state.onchain.config}
      busy={false}
      save={vi.fn()}
      run={vi.fn()}
    />,
  );
  expect(html).toContain('Données partielles');
  expect(html).toContain('Zerion');
  expect(html).toContain('Écart de réconciliation');
  expect(renderToStaticMarkup(<WalletPositions state={state} />)).toContain(
    'Écart entre le total consolidé et les détails',
  );
  state.onchain.wallets[0].status = 'ERROR';
  state.onchain.wallets[0].errorCode = 'AUTH';
  expect(
    renderToStaticMarkup(
      <WalletConnectionCard
        wallet={state.onchain.wallets[0]}
        config={state.onchain.config}
        busy={false}
        save={vi.fn()}
        run={vi.fn()}
      />,
    ),
  ).toContain('dernière valeur conservée');
});
it('settings expose neither a key input nor browser-based provider selection', () => {
  const html = renderToStaticMarkup(<ZerionSettings state={fixture()} save={vi.fn()} />);
  expect(html).not.toContain('type="password"');
  expect(html).not.toContain('DeBank');
  expect(html).toContain('quotidienne');
});
it('identifies missing historical networks, protocols and assets without asserting they were lost', () => {
  const current = normalizeZerion(portfolio(0), [{ data: [] }]);
  current.chains = [];
  const warnings = compareWalletCoverage(historicalDeBank, current);
  expect(warnings.join(' ')).toContain('Ethereum');
  expect(warnings.join(' ')).toContain('Protocol fixture');
  expect(warnings.join(' ')).toContain('USDC');
  expect(warnings.join(' ')).toContain('vérifier');
});
