import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { workspaceFixture } from '../fixtures/workspace';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('loads once, navigates without data reads and does not prefetch asset rows', async ({
  page,
}) => {
  const state = workspaceFixture();
  const initial = gate();
  let reads = 0;
  let detailRequests = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/assets/test-asset')) detailRequests++;
  });
  await page.route('**/api/v1/state', async (route) => {
    reads++;
    await initial.promise;
    await route.fulfill({ json: { data: state } });
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('status', { name: 'Chargement de votre patrimoine' })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('.workspace-loading').analyze();
  expect(accessibility.violations).toEqual([]);
  initial.release();
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();
  const timings: Record<string, number> = {};
  for (const [link, title] of [
    ['Portefeuille', 'Portefeuille'],
    ['Wallets DeFi', 'Wallets & DeFi'],
    ['Activité', 'Activité · Transactions'],
    ['Tableau de bord', 'Vue d’ensemble'],
  ]) {
    const start = Date.now();
    await page
      .getByRole('navigation', { name: 'Navigation principale' })
      .getByRole('link', { name: link })
      .click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    timings[link] = Date.now() - start;
  }
  expect(reads).toBe(1);
  expect(detailRequests).toBe(0);
  expect(errors).toEqual([]);
  await test
    .info()
    .attach('navigation-timings.json', {
      body: JSON.stringify(timings),
      contentType: 'application/json',
    });
  await page.screenshot({ path: test.info().outputPath('dashboard.png'), fullPage: true });
});

test('shows link feedback on a slow route and reuses data for detail pages', async ({ page }) => {
  const delayed = gate();
  let reads = 0;
  await page.route('**/api/v1/state', (route) => {
    reads++;
    return route.fulfill({ json: { data: workspaceFixture() } });
  });
  await page.route('**/assets/test-asset?*', async (route) => {
    await delayed.promise;
    await route.continue();
  });
  await page.goto('/portfolio');
  await page
    .getByRole('link', { name: /Bitcoin test/ })
    .first()
    .click();
  await expect(page.getByRole('status', { name: 'Chargement de la page' })).toBeVisible();
  delayed.release();
  await expect(page.getByRole('heading', { name: 'Bitcoin test', exact: true })).toBeVisible();
  expect(reads).toBe(1);
});

test('revalidates once after saving, keeps content visible and shares new state across pages', async ({
  page,
}) => {
  const state = workspaceFixture();
  const saved = gate();
  let reads = 0;
  await page.route('**/api/v1/state', async (route) => {
    reads++;
    if (reads > 1) await saved.promise;
    await route.fulfill({ json: { data: state } });
  });
  await page.route('**/api/v1/settings', async (route) => {
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    state.portfolio.name = route.request().postDataJSON().name;
    state.portfolio.version++;
    await route.fulfill({ json: { data: state.portfolio } });
  });
  await page.goto('/settings');
  await page.getByRole('textbox', { name: 'Nom', exact: true }).fill('Nom actualisé');
  await page.getByRole('button', { name: 'Enregistrer les préférences' }).click();
  await expect(page.getByText('Actualisation…', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Paramètres', exact: true })).toBeVisible();
  saved.release();
  await expect(page.locator('.portfolio-switch')).toContainText('Nom actualisé');
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link', { name: 'Tableau de bord' })
    .click();
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
  expect(reads).toBe(2);
});

test('retries initial failure and clears private content on session expiry', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/v1/state', (route) => {
    reads++;
    return reads === 1
      ? route.fulfill({ status: 503, json: { error: { message: 'Service indisponible' } } })
      : reads === 2
        ? route.fulfill({ json: { data: workspaceFixture() } })
        : route.fulfill({ status: 401, json: { error: { message: 'Session expirée' } } });
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('alert')).toContainText('Service indisponible');
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(61_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.portfolio-switch')).toHaveCount(0);
});

test('keeps navigation responsive during stale refresh and skips polling in hidden tabs', async ({
  page,
}) => {
  const refresh = gate();
  let reads = 0;
  await page.route('**/api/v1/state', async (route) => {
    reads++;
    if (reads > 1) await refresh.promise;
    await route.fulfill({ json: { data: workspaceFixture() } });
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
  await page.clock.install();
  await page.evaluate(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }),
  );
  await page.clock.fastForward(61_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(reads).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('Actualisation…', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link', { name: 'Portefeuille' })
    .click();
  await expect(page.getByRole('heading', { name: 'Portefeuille', exact: true })).toBeVisible();
  expect(reads).toBe(2);
  refresh.release();
  await expect(page.getByText('Actualisation…', { exact: true })).toHaveCount(0);
});
