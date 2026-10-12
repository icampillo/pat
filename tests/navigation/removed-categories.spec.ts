import { test, expect } from '@playwright/test';
import { applicationUiFixture } from '../fixtures/application-ui';

test('retired categories are absent from navigation, forms and category pages', async ({
  page,
}) => {
  await page.route('**/api/v1/market/refresh', (route) => route.fulfill({ json: { data: {} } }));
  await page.route('**/api/v1/state', (route) =>
    route.fulfill({ json: { data: applicationUiFixture() } }),
  );
  await page.goto('/assets/new');
  const category = page.getByRole('combobox', { name: 'Catégorie', exact: true });
  await expect(category.locator('option')).toHaveCount(5);
  await expect(page.getByRole('link', { name: /pokémon|one piece/i })).toHaveCount(0);
  for (const key of ['CRYPTO', 'METALS', 'SECURITIES', 'REAL_ESTATE', 'OTHER']) {
    const item = applicationUiFixture().categories.find((c) => c.key === key)!;
    await category.selectOption(item.id);
    await expect(page.getByRole('textbox', { name: 'Extension', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Numéro de carte', exact: true })).toHaveCount(
      0,
    );
  }
  for (const slug of ['pokemon', 'one-piece']) {
    await page.goto(`/categories/${slug}`);
    await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
  }
});
