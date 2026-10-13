import { expect, test } from '@playwright/test';
import { workspaceFixture, scopedWorkspaceFixture } from '../fixtures/workspace';
import type { WalletView } from '../../src/shared/wallets';

for (const width of [1440, 375]) {
  test(`wallet sync updates values automatically without snapshot reads at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = workspaceFixture();
    state.onchain.config.enabled = true;
    state.onchain.wallets = [
      {
        id: 'test-wallet',
        label: 'Wallet test',
        address: '0x' + '1'.repeat(40),
        enabled: true,
        included: true,
        status: 'PENDING',
        errorCode: null,
        lastSuccessAt: null,
        nextSyncAt: new Date().toISOString(),
        data: null,
        stale: true,
        referenceUsd: null,
        referenceAt: null,
      } satisfies WalletView,
    ];
    const calls = { full: 0, live: 0, status: 0 };
    const bytes = { full: 0, live: 0, status: 0 };
    await page.route('**/api/v1/market/refresh', (route) =>
      route.fulfill({
        json: {
          data: {
            failed: 0,
            hasMore: false,
            rates: 0,
            prices: 0,
            securities: { prices: 0 },
          },
        },
      }),
    );
    await page.route('**/api/v1/state*', (route) => {
      const scope = route.request().url().includes('scope=live') ? 'live' : 'full';
      calls[scope]++;
      const data: Partial<typeof state> = structuredClone(state);
      if (scope === 'live') delete data.snapshots;
      bytes[scope] += Buffer.byteLength(JSON.stringify({ data }));
      return route.fulfill({ json: { data } });
    });
    await page.route('**/api/v1/wallets/status', (route) => {
      calls.status++;
      const wallet = state.onchain.wallets[0];
      wallet.status = calls.status === 1 ? 'SYNCING' : 'OK';
      if (calls.status === 2) {
        wallet.lastSuccessAt = new Date().toISOString();
        state.totals.valueEur = '2000';
      }
      const { id, enabled, status, errorCode, lastSuccessAt, nextSyncAt } = wallet;
      const data = {
        enabled: true,
        wallets: [{ id, enabled, status, errorCode, lastSuccessAt, nextSyncAt }],
      };
      bytes.status += Buffer.byteLength(JSON.stringify({ data }));
      return route.fulfill({ json: { data } });
    });
    await page.clock.install();
    await page.goto('/dashboard');
    await expect(page.getByTestId('wealth-total')).toBeVisible();
    await page.clock.runFor(5_000);
    await expect.poll(() => calls.status).toBe(1);
    expect(calls).toEqual({ full: 1, live: 0, status: 1 });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls.status).toBe(1);
    await page.clock.runFor(5_000);
    await expect(page.getByTestId('wealth-total')).toContainText(/2[\s\u202f\u00a0]000/);
    expect(calls).toEqual({ full: 1, live: 1, status: 2 });
    await page.clock.runFor(20_000);
    expect(calls.status).toBe(2);
    await expect(page.locator('.workspace-loading')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await test.info().attach('http-fixture-metrics.json', {
      body: JSON.stringify({ calls, bytes, note: 'Synthetic HTTP fixture, not Neon billing' }),
      contentType: 'application/json',
    });
  });
}

test('manual wallet sync first queued as PENDING, then shows new values without a manual reload', async ({
  page,
}) => {
  const state = workspaceFixture();
  state.onchain.config.enabled = true;
  state.onchain.config.configured = true;
  state.onchain.wallets = [
    {
      id: 'test-wallet',
      label: 'Wallet test',
      address: '0x' + '1'.repeat(40),
      enabled: true,
      included: true,
      status: 'OK',
      errorCode: null,
      lastSuccessAt: null,
      nextSyncAt: new Date().toISOString(),
      data: null,
      stale: true,
      referenceUsd: null,
      referenceAt: null,
    } satisfies WalletView,
  ];
  let full = 0,
    wallets = 0;
  await page.route('**/api/v1/market/refresh', () => {});
  await page.route('**/api/v1/state*', (route) => {
    if (route.request().url().includes('scope=wallets')) wallets++;
    else full++;
    const data = scopedWorkspaceFixture(state, route.request().url());
    return route.fulfill({ json: { data } });
  });
  await page.route('**/api/v1/wallets/test-wallet/sync', (route) => {
    state.onchain.wallets[0].status = 'PENDING';
    return route.fulfill({ json: { data: { id: 'test-wallet', queued: true } } });
  });
  await page.route('**/api/v1/wallets/status', (route) => {
    state.onchain.wallets[0].status = 'OK';
    state.onchain.wallets[0].lastSuccessAt = new Date().toISOString();
    state.totals.valueEur = '2000';
    const { id, enabled, status, errorCode, lastSuccessAt, nextSyncAt } = state.onchain.wallets[0];
    return route.fulfill({
      json: {
        data: {
          enabled: true,
          wallets: [{ id, enabled, status, errorCode, lastSuccessAt, nextSyncAt }],
        },
      },
    });
  });
  await page.clock.install();
  await page.goto('/wallets');
  await expect(page.locator('strong').filter({ hasText: 'Wallet test' })).toBeVisible();
  await page.getByText('Détails et actions ···', { exact: true }).click();
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect.poll(() => wallets).toBe(2);
  await page.clock.runFor(5_000);
  await expect.poll(() => wallets).toBe(3);
  await page.clock.runFor(20_000);
  await page.getByRole('link', { name: 'Tableau de bord', exact: true }).click();
  await expect(page.getByTestId('wealth-total')).toContainText(/2[\s\u202f\u00a0]000/);
  expect(full).toBe(1);
  expect(wallets).toBe(3);
});
