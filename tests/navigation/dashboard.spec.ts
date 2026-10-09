import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dashboardDailyFixture, dashboardWithPropertyAndWallet } from '../fixtures/dashboard';
const money = (value: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
async function openDashboard(page: Page, state = dashboardDailyFixture()) {
  let reads = 0;
  await page.route('**/api/v1/market/refresh', () => {});
  await page.route('**/api/v1/state', (route) => {
    reads++;
    return route.fulfill({ json: { data: state } });
  });
  await page.goto('/dashboard');
  await expect(page.getByTestId('wealth-total')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return () => reads;
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
// Check rendered geometry, not only visibility: a tiny treemap is still visible.
async function expectTreemapToFillCard(page: Page) {
  const tree = page.getByRole('group', { name: 'Répartition par catégories' });
  await expect
    .poll(() =>
      tree.evaluate((el) => {
        const parent = el.getBoundingClientRect();
        const tiles = [...el.querySelectorAll('button')].map((tile) =>
          tile.getBoundingClientRect(),
        );
        return (
          tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0) /
          (parent.width * parent.height)
        );
      }),
    )
    .toBeCloseTo(1, 2);
  const bounds = await tree.evaluate((el) => {
    const parent = el.getBoundingClientRect();
    return [...el.querySelectorAll('button')].every((tile) => {
      const rect = tile.getBoundingClientRect();
      return (
        rect.left >= parent.left - 1 &&
        rect.top >= parent.top - 1 &&
        rect.right <= parent.right + 1 &&
        rect.bottom <= parent.bottom + 1
      );
    });
  });
  expect(bounds).toBe(true);
}
for (const width of [1440, 1024, 768, 375]) {
  test(`validated composition and accessibility at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openDashboard(page);
    await expect(page.getByTestId('wealth-total')).toHaveText(money(128450.74));
    await expect(page.getByTestId('investment-card')).toHaveCount(4);
    const group = page.getByRole('group', { name: 'Catégories détenues' });
    expect(
      await group.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
    ).toBe(width > 600 ? 2 : 1);
    await expect(
      page.getByRole('group', { name: 'Répartition par catégories' }).getByRole('button'),
    ).toHaveCount(4);
    await expect(
      page
        .getByRole('group', { name: 'Évolution de la valeur : Patrimoine', exact: true })
        .locator('.recharts-area-curve'),
    ).toBeVisible();
    await noOverflow(page);
    await expectTreemapToFillCard(page);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`dashboard-${width}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test('older seeded history is visible without presenting thirty days as seven', async ({
  page,
}) => {
  const state = dashboardDailyFixture();
  // A seed remains fixed in time; opening it two weeks later must not hide its history.
  state.asOf = new Date(Date.parse(state.asOf) + 14 * 86400000).toISOString();
  state.portfolio.isDemo = true;
  const reads = await openDashboard(page, state);
  const mainPeriods = page.getByRole('group', { name: 'Période du graphique', exact: true });
  const categoryPeriods = page.getByRole('group', { name: 'Période des courbes des catégories' });
  for (const periods of [mainPeriods, categoryPeriods]) {
    await expect(periods.getByRole('button', { name: '30 j', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await expect(
    page
      .getByRole('group', { name: 'Évolution de la valeur : Patrimoine', exact: true })
      .locator('.recharts-area-curve'),
  ).toBeVisible();
  const cards = page.getByTestId('investment-card');
  for (const card of await cards.all()) {
    await expect(card.getByRole('application')).toBeVisible();
    // A horizontal SVG path has zero bounding-box height, but its stroke is drawn.
    await expect
      .poll(() =>
        card
          .locator('.recharts-area-curve')
          .evaluate((path) => (path as SVGPathElement).getTotalLength()),
      )
      .toBeGreaterThan(100);
    await expect(card.locator('summary').first()).toContainText('—');
  }
  await expect(page.getByText('Pas assez de relevés sur 7 j · affichage sur 30 j.')).toHaveCount(2);
  await page.screenshot({
    path: test.info().outputPath('dashboard-older-seed-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 1000 });
  await expectTreemapToFillCard(page);
  await noOverflow(page);
  await page.screenshot({
    path: test.info().outputPath('dashboard-older-seed-mobile.png'),
    fullPage: true,
  });
  // A deliberate selection is respected; it does not silently fall back again.
  await mainPeriods.getByRole('button', { name: '7 j', exact: true }).click();
  await categoryPeriods.getByRole('button', { name: '7 j', exact: true }).click();
  await expect(page.getByText('Historique insuffisant')).toHaveCount(5);
  for (const periods of [mainPeriods, categoryPeriods]) {
    await periods.getByRole('button', { name: '30 j', exact: true }).click();
  }
  await page.getByLabel('Devise d’affichage').selectOption('USD');
  await expect(cards.first().locator('.recharts-area-curve')).toBeVisible();
  await cards.first().getByRole('link', { name: 'Cryptomonnaies' }).click();
  await expect(
    page
      .getByRole('img', { name: 'Évolution de la valeur : Cryptomonnaies' })
      .locator('.recharts-area-curve'),
  ).toBeVisible();
  expect(reads()).toBe(1);
});

test('daily seed with 401 snapshots draws curves on every period', async ({ page }) => {
  const state = dashboardDailyFixture();
  const latest = state.snapshots.at(-1)!;
  state.snapshots = Array.from({ length: 401 }, (_, index) => ({
    ...latest,
    id: `seed-${index}`,
    capturedAt: new Date(Date.parse(state.asOf) - (400 - index) * 86400000).toISOString(),
    totalEur: String(100000 + index * 70 + Math.sin(index / 7) * 1000),
    totalUsd: String((100000 + index * 70 + Math.sin(index / 7) * 1000) * 1.1),
  }));
  // The seed is captured before getState calculates the current situation.
  state.asOf = new Date(Date.parse(state.asOf) + 3600000).toISOString();
  const reads = await openDashboard(page, state);
  const mainPeriods = page.getByRole('group', { name: 'Période du graphique', exact: true });
  const mainChart = page.getByRole('group', {
    name: 'Évolution de la valeur : Patrimoine',
    exact: true,
  });
  for (const currency of ['EUR', 'USD']) {
    await page.getByLabel('Devise d’affichage').selectOption(currency);
    for (const label of ['7 j', '30 j', '3 M', '1 A', 'Tout', '7 j']) {
      await mainPeriods.getByRole('button', { name: label, exact: true }).click();
      await expect
        .poll(() =>
          mainChart
            .locator('.recharts-area-curve')
            .evaluate((path) => (path as SVGPathElement).getTotalLength()),
        )
        .toBeGreaterThan(100);
    }
    for (const label of ['7 j', '30 j']) {
      await page
        .getByRole('group', { name: 'Période des courbes des catégories' })
        .getByRole('button', { name: label, exact: true })
        .click();
      for (const card of await page.getByTestId('investment-card').all()) {
        await expect
          .poll(() =>
            card
              .locator('.recharts-area-curve')
              .evaluate((path) => (path as SVGPathElement).getTotalLength()),
          )
          .toBeGreaterThan(100);
      }
    }
  }
  expect(reads()).toBe(1);
});

test('periods, currencies, category tooltips and detail links preserve the store', async ({
  page,
}) => {
  const reads = await openDashboard(page);
  const category = page.getByTestId('investment-card').first();
  const change = category.locator('summary').first();
  const initial = await change.textContent();
  const periods = page.getByRole('group', { name: 'Période des courbes des catégories' });
  await expect(periods.getByRole('button', { name: '7 j', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await periods.getByRole('button', { name: '30 j' }).click();
  await expect(change).toHaveText(initial!);
  await change.click();
  await expect(category).toContainText('achats et ventes compris');
  await change.click();
  for (const label of ['30 j', '3 M', '1 A', 'Tout', '7 j']) {
    const button = page
      .getByRole('group', { name: 'Période du graphique', exact: true })
      .getByRole('button', { name: label, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  }
  const chart = category.getByRole('group', { name: /Évolution de la valeur/ });
  await chart.locator('[role="application"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText('Cryptomonnaies');
  await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText('€');
  await expect(chart.locator('.recharts-cartesian-axis')).toHaveCount(0);
  await page.getByLabel('Devise d’affichage').selectOption('USD');
  await expect(page.getByTestId('wealth-total')).toHaveText(money(141295.814, 'USD'));
  await expect(category).toContainText(money(31504.55, 'USD'));
  expect(reads()).toBe(1);
  await category.getByRole('link', { name: 'Cryptomonnaies' }).click();
  await expect(page).toHaveURL(/categories\/crypto$/);
  expect(reads()).toBe(1);
});

test('treemap opens details only on activation, not hover or focus', async ({ page }) => {
  const reads = await openDashboard(page);
  const tiles = page.getByRole('group', { name: 'Répartition par catégories' });
  const crypto = tiles.getByRole('button', { name: /^Cryptomonnaies/ });
  await crypto.hover();
  const details = page.getByTestId('allocation-details');
  await expect(details).toHaveCount(0);
  await crypto.focus();
  await expect(details).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(details).toContainText(money(28640.5));
  await expect(details.getByRole('link')).toHaveAttribute('href', '/categories/crypto');
  const stocks = tiles.getByRole('button', { name: /^Bourse/ });
  await stocks.hover();
  await expect(details).toContainText(money(28640.5));
  await stocks.focus();
  await page.keyboard.press('Enter');
  await expect(details).toContainText('Bourse');
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await crypto.hover();
  await expect(details).toHaveCount(0);
  await page.getByLabel('Devise d’affichage').selectOption('USD');
  await stocks.click();
  await expect(details).toContainText(money(75251.264, 'USD'));
  await page.setViewportSize({ width: 375, height: 850 });
  await tiles.getByRole('button', { name: /^Liquidités/ }).click();
  await expect(details).toContainText(money(18150, 'USD'));
  await expectTreemapToFillCard(page);
  await expect(details.getByRole('link')).toHaveAttribute('href', '/portfolio');
  await noOverflow(page);
  await page.screenshot({
    path: test.info().outputPath('allocation-mobile-detail.png'),
    fullPage: true,
  });
  expect(reads()).toBe(1);
});

test('empty, missing historical categories and incomplete values remain explicit', async ({
  page,
}) => {
  const state = dashboardDailyFixture();
  state.rows = [];
  state.cash = [];
  state.snapshots = [];
  state.totals.valueEur = '0';
  await openDashboard(page, state);
  await expect(page.getByRole('heading', { name: 'Aucune catégorie détenue' })).toBeVisible();
  await expect(
    page.getByText('Deux captures valorisées sont nécessaires sur cette période.'),
  ).toBeVisible();
  await expect(page.getByText('Aucune valeur positive à représenter.')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('dashboard-empty.png'), fullPage: true });
});

test('partial cash, missing prices, negative and null references are never complete allocation', async ({
  page,
}) => {
  const state = dashboardDailyFixture();
  state.rows[0].valueEur = null;
  state.rows[1].valueEur = '-50';
  state.cash.push({ ...state.cash[0], platform: 'inconnu', valueEur: null });
  state.totals.valueEur = null;
  state.snapshots.forEach((s) => {
    delete s.categoryValues;
    delete s.cashValues;
  });
  await openDashboard(page, state);
  await expect(page.getByTestId('wealth-total')).toHaveText('—');
  await expect(page.getByText('Répartition partielle · valeurs positives connues')).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Répartition par catégories' })
      .getByRole('button', { name: /^Liquidités connues/ }),
  ).toBeVisible();
  const cash = page.getByTestId('investment-card').filter({ hasText: 'Liquidités' });
  await expect(cash).toContainText('Valorisation incomplète');
  await expect(cash).toContainText('Historique insuffisant');
  await cash.locator('summary').click();
  await expect(cash).toContainText('Valorisation actuelle incomplète');
  await page.getByText('Toutes les catégories', { exact: false }).click();
  await expect(page.getByRole('list', { name: 'Poids des catégories' })).not.toContainText('%');
  await expect(page.locator('main')).not.toContainText(/NaN|undefined/);
  await page.screenshot({
    path: test.info().outputPath('dashboard-incomplete.png'),
    fullPage: true,
  });
});

test('many dynamic categories, long amounts, tiny allocations and mobile navigation', async ({
  page,
}) => {
  const state = dashboardDailyFixture();
  for (let i = 0; i < 12; i++) {
    const category = {
      id: `other-${i}`,
      key: `OTHER_${i}`,
      label: `Collection ${i}`,
      color: '#aabbcc',
    };
    state.categories.push(category);
    state.rows.push({
      ...state.rows[0],
      id: `other-asset-${i}`,
      category,
      categoryId: category.id,
      valueEur: '1',
    });
  }
  state.rows[0].valueEur = '1234567890123.45';
  state.totals.valueEur = '1234567890123.45';
  await openDashboard(page, state);
  await expect(page.getByTestId('investment-card')).toHaveCount(16);
  for (const width of [1440, 1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    expect(
      await page.getByTestId('wealth-total').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await page.getByText('Toutes les catégories', { exact: false }).click();
  await expect(
    page.getByRole('list', { name: 'Poids des catégories' }).getByRole('link'),
  ).toHaveCount(16);
  const mobile = page.getByRole('navigation', { name: 'Navigation mobile' });
  await expect(mobile).toBeVisible();
  await mobile.getByRole('button', { name: /Plus/ }).click();
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
  await page.getByRole('dialog').getByRole('link', { name: 'Wallets DeFi' }).click();
  await expect(page).toHaveURL(/wallets$/);
});

test('property equity and included wallets keep their perimeter and other page styles', async ({
  page,
}) => {
  await openDashboard(page, dashboardWithPropertyAndWallet());
  const estate = page.getByTestId('investment-card').filter({ hasText: 'Immobilier' });
  await expect(estate).toContainText(money(120000));
  await expect(estate).toContainText(money(300000));
  await expect(estate).toContainText(money(180000));
  await expect(estate).toContainText('Capital remboursé inclus');
  await expect(
    page.getByTestId('investment-card').filter({ hasText: 'Cryptomonnaies' }),
  ).toContainText(money(29640.5));
  await page.getByLabel('Devise d’affichage').selectOption('USD');
  await expect(estate).toContainText(money(132000, 'USD'));
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link', { name: 'Portefeuille', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Portefeuille', exact: true })).toBeVisible();
  expect(
    await page
      .locator('main')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--accent').trim()),
  ).not.toBe('#7434ff');
});

test.describe('touch interactions', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('touch details, chart tooltip and bottom navigation remain reachable', async ({ page }) => {
    await openDashboard(page);
    await page
      .getByRole('group', { name: 'Répartition par catégories' })
      .getByRole('button', { name: /^Liquidités/ })
      .tap();
    await expect(page.getByTestId('allocation-details')).toContainText(money(16500));
    const cash = page.getByTestId('investment-card').filter({ hasText: 'Liquidités' });
    await cash.locator('summary').tap();
    await expect(cash).toContainText('achats et ventes compris');
    await cash.locator('summary').tap();
    const chart = cash.getByRole('group', { name: /Évolution de la valeur/ });
    await chart.tap({ position: { x: 140, y: 30 } });
    await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText('Liquidités');
    const lastLink = page.getByRole('link', { name: 'Voir le portefeuille →', exact: true }).last();
    await lastLink.scrollIntoViewIfNeeded();
    const linkBox = await lastLink.boundingBox();
    const navBox = await page.getByRole('navigation', { name: 'Navigation mobile' }).boundingBox();
    expect(linkBox!.y + linkBox!.height).toBeLessThanOrEqual(navBox!.y);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath('dashboard-mobile-viewport.png') });
  });
});
