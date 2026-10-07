import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { AppState } from '../../src/shared/types';
import { dashboardFixture, dashboardWithPropertyAndWallet } from '../fixtures/dashboard';

const money = (value: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
async function openDashboard(page: Page, state: AppState) {
  let reads = 0;
  await page.route('**/api/v1/state', (route) => {
    reads++;
    return route.fulfill({ json: { data: state } });
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
  return () => reads;
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

for (const width of [1440, 1024, 768, 375]) {
  test(`dashboard composition, accessibility and responsive at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openDashboard(page, dashboardFixture());
    await expect(page.getByTestId('wealth-total')).toHaveText(money(128450.74));
    await expect(
      page.getByRole('group', { name: 'Indicateurs du patrimoine' }).getByRole('region'),
    ).toHaveCount(4);
    await expect(page.getByTestId('investment-card')).toHaveCount(3);
    const columns = await page
      .getByRole('group', { name: 'Catégories détenues' })
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(width >= 1440 ? 3 : width >= 640 ? 2 : 1);
    await expect(
      page
        .getByRole('img', { name: 'Évolution de la valeur : Patrimoine' })
        .locator('.recharts-area-curve'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tout', exact: true })).toBeVisible();
    await noOverflow(page);
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

test('EUR/USD, all periods, keyboard, tooltip and actions retain the shared store', async ({
  page,
}) => {
  const reads = await openDashboard(page, dashboardFixture());
  await expect(page.getByRole('region', { name: 'Capital investi', exact: true })).toContainText(
    money(90000),
  );
  await expect(page.getByRole('region', { name: 'Liquidités', exact: true })).toContainText(
    money(16500),
  );
  await expect(page.getByText('après flux · estimé')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Poids des catégories' })).toContainText('12.8 %');
  const chart = page.getByRole('img', { name: 'Évolution de la valeur : Patrimoine' });
  await chart.hover({ position: { x: 200, y: 100 } });
  await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText('Patrimoine');
  await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText('€');
  await page.screenshot({ path: test.info().outputPath('dashboard-tooltip.png'), fullPage: true });
  for (const label of ['24h', '7j', '30j', '90j', '180j', '1y', 'Tout']) {
    const button = page.getByRole('button', { name: label, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toBeFocused();
    expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  }
  await page.getByLabel('Devise d’affichage').selectOption('USD');
  await expect(page.getByTestId('wealth-total')).toHaveText(money(141295.814, 'USD'));
  await expect(page.getByRole('region', { name: 'Capital investi', exact: true })).toContainText(
    money(99000, 'USD'),
  );
  await expect(page.getByText('après flux · estimé')).toHaveCount(0);
  await expect(page.getByText('Performance ajustée indisponible')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Importer un CSV Bourse' })).toHaveAttribute(
    'href',
    '/categories/stocks#import-bourse',
  );
  await expect(page.getByRole('link', { name: 'Ajouter un actif', exact: true })).toHaveAttribute(
    'href',
    '/assets/new',
  );
  expect(reads()).toBe(1);
  await page.getByTestId('investment-card').first().click();
  await expect(page).toHaveURL(/categories\/crypto$/);
  expect(reads()).toBe(1);
});

test('empty portfolio and insufficient history have honest actionable states', async ({ page }) => {
  const state = dashboardFixture();
  state.rows = [];
  state.cash = [];
  state.snapshots = [];
  Object.assign(state.totals, { valueEur: '0', valueUsd: '0', costEur: '0', costUsd: '0' });
  await openDashboard(page, state);
  await expect(page.getByTestId('wealth-total')).toHaveText(money(0));
  await expect(page.getByRole('heading', { name: 'Aucune catégorie détenue' })).toBeVisible();
  await expect(
    page.getByText('Deux captures valorisées sont nécessaires sur cette période.'),
  ).toBeVisible();
  await expect(page.getByText('après flux · estimé')).toHaveCount(0);
  await expect(page.getByTestId('investment-card')).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('dashboard-empty.png'), fullPage: true });
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
});

test('missing prices, cost basis and FX never masquerade as zero or complete allocation', async ({
  page,
}) => {
  const state = dashboardFixture();
  state.rows[0].valueEur = null;
  state.rows[0].valueUsd = null;
  state.rows[0].costEur = null;
  state.rows[0].metadata.costBasis = 'UNKNOWN';
  state.cash[0].valueEur = null;
  state.snapshots = [state.snapshots[0], { ...state.snapshots[1], totalEur: null }];
  Object.assign(state.totals, {
    valueEur: null,
    valueUsd: null,
    costEur: null,
    incompleteCostBasis: true,
  });
  await openDashboard(page, state);
  await expect(page.getByTestId('wealth-total')).toHaveText('—');
  await expect(page.getByRole('region', { name: 'Capital investi', exact: true })).toContainText(
    '—',
  );
  await expect(page.getByRole('region', { name: 'Liquidités', exact: true })).toContainText(
    'Conversion incomplète',
  );
  await expect(page.getByRole('list', { name: 'Poids des catégories' })).not.toContainText('%');
  await expect(
    page.getByText('Deux captures valorisées sont nécessaires sur cette période.'),
  ).toBeVisible();
  await expect(page.getByText('Performance ajustée indisponible')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/NaN|undefined/);
});

test('property equity, debt and included wallet retain their financial meaning', async ({
  page,
}) => {
  await openDashboard(page, dashboardWithPropertyAndWallet());
  await expect(page.getByTestId('wealth-total')).toHaveText(money(249450.74));
  const estate = page.getByTestId('investment-card').filter({ hasText: 'Immobilier' });
  await expect(estate).toContainText(money(120000));
  await expect(estate).toContainText(money(300000));
  await expect(estate).toContainText(money(180000));
  await expect(estate).toContainText('capital remboursé inclus');
  const crypto = page.getByTestId('investment-card').filter({ hasText: 'Cryptomonnaies' });
  await expect(crypto).toContainText(money(29640.5));
  await expect(crypto).toContainText('2 positions');
  await expect(page.getByRole('region', { name: 'Positions suivies', exact: true })).toContainText(
    '5',
  );
  await expect(page.getByText('après flux · estimé')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Capital investi', exact: true })).toContainText(
    '—',
  );
  await page.getByLabel('Devise d’affichage').selectOption('USD');
  await expect(page.getByTestId('wealth-total')).toHaveText(money(274395.814, 'USD'));
  await expect(estate).toContainText(money(132000, 'USD'));
  await page.setViewportSize({ width: 375, height: 1000 });
  await noOverflow(page);
  await page.screenshot({
    path: test.info().outputPath('dashboard-property-wallet.png'),
    fullPage: true,
  });
});

test('long amounts wrap without clipping at mobile and tablet widths', async ({ page }) => {
  const state = dashboardFixture();
  Object.assign(state.totals, {
    valueEur: '1234567890123.45',
    valueUsd: '1358024679135.795',
    costEur: '1000000000000',
  });
  state.rows[0].valueEur = '1234567890123.45';
  await openDashboard(page, state);
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow(page);
    expect(
      await page.getByTestId('wealth-total').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await expect(page.getByTestId('wealth-total')).toHaveText(money(1234567890123.45));
  await page.screenshot({
    path: test.info().outputPath('dashboard-long-amounts.png'),
    fullPage: true,
  });
});

test('snapshot action is disabled while saving and reports API errors then success', async ({
  page,
}) => {
  const reads = await openDashboard(page, dashboardFixture());
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saves = 0;
  await page.route('**/api/v1/snapshots', async (route) => {
    saves++;
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    if (saves === 1) {
      await pending;
      return route.fulfill({ status: 503, json: { error: { message: 'Snapshot indisponible' } } });
    }
    return route.fulfill({ json: { data: { id: 'new-snapshot' } } });
  });
  const button = page.getByRole('button', { name: 'Enregistrer un snapshot' });
  await button.click();
  await expect(button).toBeDisabled();
  release();
  await expect(page.getByRole('status')).toContainText('Snapshot indisponible');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('status')).toContainText('Enregistrement effectué.');
  expect(saves).toBe(2);
  expect(reads()).toBe(2);
});

test('allocation sectors, legend and keyboard show persistent details in the chosen currency', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reads = await openDashboard(page, dashboardFixture());
  const chart = page.getByRole('group', { name: /Répartition par catégories/ });
  const legend = page.getByRole('list', { name: 'Poids des catégories' });
  const details = page.getByTestId('allocation-details');
  const crypto = chart.getByRole('button', { name: /^Cryptomonnaies/ });
  // The SVG bounding box includes the donut hole: click a point on the actual arc.
  const point = await crypto.evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() * 0.12);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    const box = path.getBBox();
    const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(
      path.getScreenCTM()!,
    );
    return {
      x: screen.x + (center.x - screen.x) * 0.08,
      y: screen.y + (center.y - screen.y) * 0.08,
    };
  });
  await page.mouse.click(point.x, point.y);
  await page.mouse.move(0, 0);
  await expect(crypto).toHaveAttribute('aria-pressed', 'true');
  await expect(details).toContainText('Cryptomonnaies');
  await expect(details).toContainText(money(28640.5));
  await expect(details).toContainText('22.3 % du patrimoine');
  await expect(details.getByRole('link')).toHaveAttribute('href', '/categories/crypto');
  await expect(legend.getByRole('button', { name: /Cryptomonnaies/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const stocks = chart.getByRole('button', { name: /^Bourse/ });
  await stocks.focus();
  await page.keyboard.press('Enter');
  await expect(details).toContainText(money(68410.24));
  await expect(stocks).toBeFocused();
  expect(await stocks.evaluate((el) => getComputedStyle(el).strokeWidth)).toBe('2px');
  await page.keyboard.press('Escape');
  await expect(details).toContainText('Cliquez sur une section');
  await stocks.focus();
  await page.keyboard.press('Space');
  await expect(details).toContainText('Bourse');
  await page.getByLabel('Devise d’affichage').selectOption('USD');
  await expect(details).toContainText(money(75251.264, 'USD'));
  await expect(details).toContainText('53.3 % du patrimoine');
  await expect(details.getByRole('link')).toHaveAttribute('href', '/categories/stocks');
  await legend.getByRole('button', { name: /Liquidités/ }).click();
  await expect(details).toContainText(money(18150, 'USD'));
  await page.getByRole('button', { name: 'Effacer la sélection' }).click();
  await expect(details).toContainText('Cliquez sur une section');
  await legend.getByRole('button', { name: /Bourse/ }).click();
  await expect(details).toContainText('Bourse');
  await page.screenshot({
    path: test.info().outputPath('allocation-selected-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await legend.getByRole('button', { name: /Métaux précieux/ }).click();
  await expect(details).toContainText(money(16390, 'USD'));
  await noOverflow(page);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath('allocation-selected-mobile.png'),
    fullPage: true,
  });
  expect(reads()).toBe(1);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`allocation fills progressively and respects motion preference: ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      const frames = new Set<string>();
      Object.assign(window, { allocationFrames: frames });
      new MutationObserver(() => {
        const path = document.querySelector(
          '[aria-label^="Répartition par catégories"] path[role="button"]',
        );
        const geometry = path?.getAttribute('d');
        if (geometry) frames.add(geometry);
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['d'],
      });
    });
    await openDashboard(page, dashboardFixture());
    await expect(
      page.getByRole('group', { name: /Répartition par catégories/ }).getByRole('button'),
    ).toHaveCount(4);
    // Observe the full 1s entrance, not just the final static picture.
    const frameCount = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          setTimeout(
            () =>
              resolve(
                (window as unknown as { allocationFrames: Set<string> }).allocationFrames.size,
              ),
            1400,
          );
        }),
    );
    if (reducedMotion === 'reduce') expect(frameCount).toBe(1);
    else expect(frameCount).toBeGreaterThan(5);
  });
}

test('single-section allocation remains selectable and incomplete totals never acquire a percentage', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = dashboardFixture();
  state.rows = [state.rows[0]];
  state.cash = [];
  state.totals.valueEur = null;
  await openDashboard(page, state);
  const chart = page.getByRole('group', { name: /Répartition par catégories/ });
  await expect(chart.getByRole('button')).toHaveCount(1);
  const button = chart.getByRole('button', { name: /^Cryptomonnaies/ });
  await button.focus();
  await button.press('Enter');
  const details = page.getByTestId('allocation-details');
  await expect(details).toContainText(money(28640.5));
  await expect(details).toContainText('Poids indisponible');
  await expect(details).not.toContainText('%');
  await button.press('Enter');
  await expect(details).toContainText('Cliquez sur une section');
});
