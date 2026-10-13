import { expect, test } from '@playwright/test';
import { workspaceFixture } from '../fixtures/workspace';

for (const outcome of ['changed', 'unchanged', 'failure']) {
  const failure = outcome === 'failure';
  const changed = outcome === 'changed';
  test(`opening sync is nonblocking, refreshes only actual changes and survives navigation (${outcome})`, async ({
    page,
  }) => {
    const state = workspaceFixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    let syncs = 0;
    let snapshots = 0;
    page.on('request', (request) => {
      if (request.url().includes('/snapshots') && request.method() === 'POST') snapshots++;
    });
    await page.route('**/api/v1/state*', (route) => {
      reads++;
      return route.fulfill({ json: { data: state } });
    });
    await page.route('**/api/v1/market/refresh', async (route) => {
      syncs++;
      expect(route.request().method()).toBe('POST');
      await gate;
      if (changed) {
        state.rows[0].price = '2000';
        state.rows[0].valueEur = '2000';
        state.totals.valueEur = '2000';
      }
      await route.fulfill({
        json: {
          data: {
            failed: failure ? 1 : 0,
            hasMore: false,
            rates: 0,
            prices: changed ? 1 : 0,
            securities: { prices: 0 },
          },
        },
      });
    });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();
    await expect.poll(() => syncs).toBe(1);
    expect(reads).toBe(1);
    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await nav.getByRole('link', { name: 'Portefeuille' }).click();
    await expect(page.getByRole('heading', { name: 'Portefeuille', exact: true })).toBeVisible();
    release();
    await expect.poll(() => reads).toBe(changed ? 2 : 1);
    await page
      .getByRole('link', { name: /Bitcoin test/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Bitcoin test', exact: true })).toBeVisible();
    if (failure)
      await expect(
        page.getByText(
          'Certains cours sont indisponibles ; dernières valeurs et dates conservées.',
        ),
      ).toBeVisible();
    else if (changed) await expect(page.getByText(/2[\s\u202f\u00a0]000/).first()).toBeVisible();
    await nav.getByRole('link', { name: 'Tableau de bord', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect(syncs).toBe(1);
    expect(snapshots).toBe(0);
    await page.reload();
    await expect.poll(() => syncs).toBe(2);
  });
}
