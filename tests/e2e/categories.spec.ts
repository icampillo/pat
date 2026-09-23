import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

test('dashboard simplifié, catégories, devises, historique et mobile', async ({ page }) => {
  const credentials = JSON.parse(readFileSync('.local/e2e-category-access.json', 'utf8'));
  await page.goto('/login');
  await page.getByLabel('Adresse e-mail').fill(credentials.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Ouvrir mon portefeuille' }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByText('Aucune catégorie détenue')).toBeVisible();
  const state = (await (await page.request.get('/api/v1/state')).json()).data;
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/v1/${path}`, {
      data,
      headers: { 'Idempotency-Key': randomUUID(), Origin: 'http://localhost:3001' },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).data;
  };
  await post('fx-rates', {
    eurUsd: '1.25',
    observedAt: new Date(Date.now() - 10000).toISOString(),
  });
  for (const [key, name, cost] of [
    ['CRYPTO', 'Crypto catégorie', '80'],
    ['SECURITIES', 'Action sans coût', undefined],
  ]) {
    const category = state.categories.find((item: { key: string }) => item.key === key);
    const asset = await post('assets', {
      categoryId: category.id,
      name,
      symbol: name,
      currency: 'EUR',
      platform: 'Personnel',
      metadata: {},
      quantity: '2',
      ...(cost ? { acquisitionCost: cost } : {}),
    });
    await post(`assets/${asset.id}/prices`, { price: '50', observedAt: new Date().toISOString() });
  }
  await post('snapshots', {});
  await page.reload();
  await expect(page.locator('.category-card')).toHaveCount(2);
  await expect(page.locator('main .metrics')).toHaveCount(0);
  await expect(page.locator('main table')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Évolution du patrimoine' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Répartition', exact: true })).toBeVisible();
  mkdirSync('.local/screenshots', { recursive: true });
  await page.screenshot({
    path: '.local/screenshots/categories-dashboard-desktop.png',
    fullPage: true,
  });
  await page.locator('a.category-card[href="/categories/crypto"]').click();
  await expect(page.locator('h1')).toHaveText('Cryptomonnaies');
  await expect(page.locator('.category-metrics .metric').first()).toContainText('100,00');
  await expect(page.locator('.category-metrics .metric').nth(2)).toContainText('80,00');
  await expect(page.getByRole('button', { name: '30j', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const name of ['7j', '90j', '1 an', 'Tout', '30j']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await page.getByRole('combobox', { name: 'Devise d’affichage', exact: true }).selectOption('USD');
  await expect(page.locator('.category-metrics .metric').first()).toContainText('125,00');
  await page.screenshot({ path: '.local/screenshots/category-desktop.png', fullPage: true });
  for (const path of [
    '/dashboard',
    '/categories/crypto',
    '/categories/stocks',
    '/categories/pokemon',
  ]) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    for (const width of [1440, 900, 375]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        `${path} at ${width}`,
      ).toBe(false);
    }
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      axe.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) })),
    ).toEqual([]);
    if (path === '/categories/stocks')
      await expect(page.getByText('Données d’acquisition incomplètes')).toBeVisible();
    if (path === '/categories/pokemon')
      await expect(
        page.getByRole('heading', { name: 'Aucun actif détenu dans cette catégorie' }),
      ).toBeVisible();
    if (path === '/categories/crypto')
      await page.screenshot({ path: '.local/screenshots/category-mobile.png', fullPage: true });
    if (path === '/dashboard')
      await page.screenshot({
        path: '.local/screenshots/categories-dashboard-mobile.png',
        fullPage: true,
      });
  }
  // Next.js can stream a 200 response before notFound() resolves after authentication.
  await page.goto('/categories/inconnue');
  await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
});
