import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { workspaceFixture } from '../fixtures/workspace';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function rects(locator: Locator) {
  return locator.evaluateAll((elements) =>
    elements.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
}
async function trackShifts(page: Page) {
  await page.evaluate(() => {
    const shifts: number[] = [];
    Object.assign(window, { loadingShifts: shifts });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Include recent-input shifts: ordinary CLS excludes click-induced regressions.
        shifts.push((entry as PerformanceEntry & { value: number }).value);
      }
    }).observe({ type: 'layout-shift' });
  });
}
async function expectNoShifts(page: Page) {
  expect(
    await page.evaluate(() =>
      (window as unknown as { loadingShifts: number[] }).loadingShifts.reduce((a, b) => a + b, 0),
    ),
  ).toBe(0);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/market/refresh', () => {});
});

for (const width of [1440, 375]) {
  for (const path of [
    '/dashboard',
    '/categories/crypto',
    '/portfolio',
    '/activity',
    '/activity?view=history',
    '/wallets',
    '/settings',
    '/assets/new',
  ]) {
    test(`contextual initial loading ${path} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const initial = gate();
      await page.route('**/api/v1/state', async (route) => {
        await initial.promise;
        await route.fulfill({ json: { data: workspaceFixture() } });
      });
      await page.goto(path);
      const skeleton = page.getByRole('status', { name: 'Chargement de votre patrimoine' });
      await expect(skeleton).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const frame = await rects(page.locator('.app-body, .main, .topbar'));
      const hero =
        path === '/dashboard' ? await rects(page.locator('[class*="overview"] > section')) : [];
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      expect(
        await skeleton
          .locator('.skeleton')
          .first()
          .evaluate((el) => getComputedStyle(el).animationName),
      ).toBe('none');
      if (path === '/dashboard') {
        await expect(skeleton.locator('[class*="overview"]')).toHaveCount(1);
        await expect(skeleton.locator('.skeleton-treemap')).toHaveCount(1);
        await expect(skeleton.locator('[class*="categoryCard"]')).toHaveCount(4);
        const axe = await new AxeBuilder({ page }).include('.workspace-loading').analyze();
        expect(axe.violations).toEqual([]);
      }
      if (path.includes('history')) await expect(skeleton.locator('.chart')).toHaveCount(1);
      await page.screenshot({ path: test.info().outputPath('initial.png'), fullPage: true });
      initial.release();
      await expect(skeleton).toHaveCount(0);
      await expect(page.locator('#main')).toBeVisible();
      const loaded = await rects(page.locator('.app-body, .main, .topbar'));
      // Data-dependent page height varies, but the shell/content origin and width must not jump.
      expect(loaded.map(({ x, y, width }) => ({ x, y, width }))).toEqual(
        frame.map(({ x, y, width }) => ({ x, y, width })),
      );
      if (path === '/dashboard') {
        const actual = await rects(page.locator('[class*="overview"] > section'));
        expect(actual).toHaveLength(hero.length);
        for (let i = 0; i < actual.length; i++) {
          for (const key of ['x', 'y', 'width', 'height'] as const)
            expect(
              Math.abs(actual[i][key] - hero[i][key]),
              'initial hero ' + key,
            ).toBeLessThanOrEqual(1);
        }
      }
      await expect(page.locator('.navigation-progress')).toHaveCount(0);
    });
  }

  for (const destination of ['category', 'navigation', 'button'] as const) {
    test(`slow ${destination} keeps every clicked element stable at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route('**/api/v1/state', (route) =>
        route.fulfill({ json: { data: workspaceFixture() } }),
      );
      const delayed = gate();
      const path =
        destination === 'category'
          ? '/categories/crypto'
          : destination === 'navigation'
            ? '/portfolio'
            : '/assets/new';
      await page.route(`**${path}?*`, async (route) => {
        await delayed.promise;
        await route.continue();
      });
      await page.goto('/dashboard');
      await expect(page.getByTestId('wealth-total')).toBeVisible();
      const link =
        destination === 'category'
          ? page.getByRole('link', { name: 'Cryptomonnaies', exact: true })
          : destination === 'navigation'
            ? page
                .getByRole('navigation', {
                  name: width === 375 ? 'Navigation mobile' : 'Navigation principale',
                })
                .getByRole('link', { name: 'Portefeuille', exact: true })
            : page.getByRole('link', { name: 'Ajouter un actif', exact: true });
      await link.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const elements = link.locator('xpath=ancestor::*[self::article][1]').or(link);
      const before = await rects(elements);
      const children = await rects(link.locator(':scope > *'));
      await trackShifts(page);
      await link.click();
      const progress = page.getByRole('status', { name: 'Chargement de la page' });
      await expect(progress).toBeVisible();
      expect(await rects(elements)).toEqual(before);
      expect(await rects(link.locator(':scope > :not(.navigation-progress)'))).toEqual(children);
      await expect(page.getByTestId('wealth-total')).toBeVisible();
      await expect(page.locator('.workspace-loading')).toHaveCount(0);
      await expectNoShifts(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(
        await progress.locator('span').evaluate((el) => getComputedStyle(el).animationName),
      ).toBe('none');
      await page.screenshot({ path: test.info().outputPath('pending.png'), fullPage: true });
      delayed.release();
      await expect(page).toHaveURL(new RegExp(path + '$'));
      await expect(progress).toHaveCount(0);
    });
  }

  test(`submission and network failure preserve button geometry at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/v1/state', (route) =>
      route.fulfill({ json: { data: workspaceFixture() } }),
    );
    const saving = gate();
    await page.route('**/api/v1/zerion/config', async (route) => {
      await saving.promise;
      await route.fulfill({ status: 503, json: { error: { message: 'Service indisponible' } } });
    });
    await page.goto('/settings');
    const button = page.getByRole('button', { name: 'Enregistrer Zerion' });
    await button.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const before = await button.boundingBox();
    await trackShifts(page);
    await button.click();
    const pending = page.getByRole('button', { name: 'Enregistrement…', exact: true });
    await expect(pending).toBeDisabled();
    expect(await pending.boundingBox()).toEqual(before);
    await expect(page.locator('.workspace-loading')).toHaveCount(0);
    await expectNoShifts(page);
    saving.release();
    await expect(button).toBeEnabled();
    expect(await button.boundingBox()).toEqual(before);
    await expect(page.getByRole('status')).toContainText('Service indisponible');
  });
}

test('silent refresh preserves content and filters, including failure and retry', async ({
  page,
}) => {
  const state = workspaceFixture();
  const refreshing = gate();
  let reads = 0;
  await page.route('**/api/v1/state', async (route) => {
    reads++;
    if (reads === 2) {
      await refreshing.promise;
      await route.fulfill({ status: 503, json: { error: { message: 'Réseau indisponible' } } });
    } else await route.fulfill({ json: { data: state } });
  });
  await page.goto('/portfolio');
  const filter = page.getByRole('textbox', { name: 'Rechercher un actif' });
  await filter.fill('Bitcoin');
  const content = page.getByRole('link', { name: /Bitcoin test/ }).first();
  const before = await content.boundingBox();
  await page.clock.install();
  await trackShifts(page);
  await page.clock.fastForward(61_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => reads).toBe(2);
  await expect(content).toBeVisible();
  await expect(
    page.locator('.workspace-loading, .navigation-progress, .workspace-refresh'),
  ).toHaveCount(0);
  refreshing.release();
  await expect(page.getByRole('alert')).toContainText('Les dernières données restent affichées');
  expect(await content.boundingBox()).toEqual(before);
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect.poll(() => reads).toBe(3);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(filter).toHaveValue('Bitcoin');
  expect(await content.boundingBox()).toEqual(before);
  await expectNoShifts(page);
});

test('instant navigation never paints a progress indicator', async ({ page }) => {
  await page.route('**/api/v1/state', (route) =>
    route.fulfill({ json: { data: workspaceFixture() } }),
  );
  await page.goto('/dashboard');
  await expect(page.getByTestId('wealth-total')).toBeVisible();
  await page.clock.install();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.getByRole('link', { name: 'Portefeuille', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Portefeuille', exact: true })).toBeVisible();
  await expect(page.locator('.navigation-progress')).toHaveCount(0);
  await page.clock.fastForward(500);
  await expect(page.locator('.navigation-progress')).toHaveCount(0);
});

test('mobile drawer keeps slow navigation feedback until the route commits', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/v1/state', (route) =>
    route.fulfill({ json: { data: workspaceFixture() } }),
  );
  const delayed = gate();
  await page.route('**/settings?*', async (route) => {
    await delayed.promise;
    await route.continue();
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Plus : ouvrir la navigation' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('link', { name: 'Paramètres', exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(page.locator('.navigation-progress')).toBeVisible();
  delayed.release();
  await expect(page.getByRole('heading', { name: 'Paramètres', exact: true })).toBeVisible();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('.navigation-progress')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Navigation mobile' })
    .getByRole('link', { name: 'Vue', exact: true })
    .click();
  await expect(page.getByTestId('wealth-total')).toBeVisible();
  await expect(drawer).toHaveCount(0);
});
