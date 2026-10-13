import { expect, test } from '@playwright/test';
import { applicationUiFixture } from '../fixtures/application-ui';
import { scopedWorkspaceFixture, workspaceFixture } from '../fixtures/workspace';

test('loads simple pages with scoped data, then reuses full data across financial navigation', async ({
  page,
}) => {
  const state = applicationUiFixture();
  const scopes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/market/refresh', () => {});
  await page.route('**/api/v1/state*', (route) => {
    scopes.push(new URL(route.request().url()).searchParams.get('scope') ?? 'full');
    return route.fulfill({ json: { data: scopedWorkspaceFixture(state, route.request().url()) } });
  });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Paramètres', exact: true })).toBeVisible();
  expect(scopes).toEqual(['settings']);
  const nav = page.getByRole('complementary');
  await nav.getByRole('link', { name: 'Wallets DeFi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Wallets DeFi', exact: true })).toBeVisible();
  expect(scopes).toEqual(['settings', 'wallets']);
  let reads = 0;
  const asOf = new Date().toISOString();
  await page.route('**/api/v1/wallets/wallet/history', (route) => {
    reads++;
    return route.fulfill({
      json: {
        data: {
          asOf,
          points: Array.from({ length: 401 }, (_, i) => ({
            date: new Date(Date.parse(asOf) - (400 - i) * 86400000).toISOString(),
            value: String(100 + i),
          })),
        },
      },
    });
  });
  expect(reads).toBe(0);
  await page.getByText('Détails et actions ···', { exact: true }).click();
  await page.getByRole('button', { name: 'Consulter la courbe du wallet' }).click();
  for (const period of ['7d', '30d', '90d', '1y', 'all']) {
    await page.getByRole('combobox', { name: 'Période', exact: true }).selectOption(period);
    await expect(page.getByRole('img', { name: 'Évolution de la valeur : Wallet' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Masquer la courbe du wallet' }).click();
  await page.getByRole('button', { name: 'Consulter la courbe du wallet' }).click();
  expect(reads).toBe(1);
  await nav.getByRole('link', { name: 'Tableau de bord', exact: true }).click();
  await expect(page.getByTestId('wealth-total')).toBeVisible();
  expect(scopes).toEqual(['settings', 'wallets', 'full']);
  for (const label of ['Wallets DeFi', 'Paramètres', 'Tableau de bord']) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  expect(scopes).toEqual(['settings', 'wallets', 'full']);
  expect(errors).toEqual([]);
});

test('loads price history on demand, appends pages and reopens without repeating reads', async ({
  page,
}) => {
  const state = workspaceFixture();
  let reads = 0;
  await page.route('**/api/v1/market/refresh', () => {});
  await page.route('**/api/v1/state*', (route) => route.fulfill({ json: { data: state } }));
  await page.route('**/api/v1/assets/test-asset/prices*', (route) => {
    reads++;
    const next = new URL(route.request().url()).searchParams.get('cursor');
    expect(next).toBe(reads === 1 ? null : 'next-page');
    const items = Array.from({ length: next ? 2 : 50 }, (_, i) => ({
      id: `${reads}-${i}`,
      observedAt: '2026-10-01T12:00:00Z',
      price: String(100 + i),
      source: 'test',
    }));
    return route.fulfill({ json: { data: { items, nextCursor: next ? null : 'next-page' } } });
  });
  await page.goto('/assets/test-asset');
  await expect(page.getByRole('heading', { name: 'Bitcoin test', exact: true })).toBeVisible();
  expect(reads).toBe(0);
  await page.getByRole('button', { name: 'Consulter l’historique des prix' }).click();
  await expect(page.locator('.price-list > div')).toHaveCount(50);
  await page.getByRole('button', { name: 'Charger les cours précédents' }).click();
  await expect(page.locator('.price-list > div')).toHaveCount(52);
  await expect(page.getByRole('button', { name: 'Charger les cours précédents' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Masquer l’historique des prix' }).click();
  await page.getByRole('button', { name: 'Consulter l’historique des prix' }).click();
  await expect(page.locator('.price-list > div')).toHaveCount(52);
  expect(reads).toBe(2);
});
