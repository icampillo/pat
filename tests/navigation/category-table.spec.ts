import { expect, test } from '@playwright/test';
import { applicationUiFixture } from '../fixtures/application-ui';
import { scopedWorkspaceFixture } from '../fixtures/workspace';

for (const width of [1440, 768, 464, 375, 320]) {
  test(`category asset names remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = applicationUiFixture();
    const name = 'ISHARES MSCI WORLD SWAP PEA UCITS ETF EUR (ACC)';
    for (const row of state.rows) row.name = name;
    await page.route('**/api/v1/market/refresh', (route) => route.abort());
    await page.route('**/api/v1/state*', (route) =>
      route.fulfill({ json: { data: scopedWorkspaceFixture(state, route.request().url()) } }),
    );

    for (const slug of ['stocks', 'crypto', 'precious-metals', 'other']) {
      await page.goto(`/categories/${slug}`);
      const region = page.getByRole('region', { name: 'Actifs de la catégorie' });
      const link = region.getByRole('link', { name, exact: true }).first();
      await expect(link).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await link.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        lines:
          element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight),
      }));
      expect(geometry.width).toBeGreaterThanOrEqual(200);
      expect(geometry.lines).toBeLessThanOrEqual(3);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await region.scrollIntoViewIfNeeded();
      await region.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await expect(
        region.getByRole('columnheader', { name: 'Plus-value latente' }),
      ).toBeInViewport();
      await region.evaluate((element) => {
        element.scrollLeft = 0;
      });
      if (slug === 'stocks') {
        await region.screenshot({ path: test.info().outputPath('category-table.png') });
      }
    }
  });
}
