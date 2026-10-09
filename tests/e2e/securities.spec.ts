import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, mkdirSync } from 'node:fs';

test('import Bourso : fichier, aperçu, confirmation et présentation mobile', async ({ page }) => {
  const credentials = JSON.parse(readFileSync('.local/e2e-category-access.json', 'utf8'));
  await page.goto('/login');
  await page.getByLabel('Adresse e-mail').fill(credentials.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Ouvrir mon portefeuille' }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole('link', { name: 'Importer un CSV Bourse' }).click();
  await expect(page.getByRole('heading', { name: 'Bourse', exact: true })).toBeVisible();
  const csv =
    'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation\nETF test;FR0011871128;2;10;11;0;21,99;1,98;9,90';
  await page.route('**/api/v1/securities/imports/preview', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      csv,
      platform: 'BoursoBank PEA',
      boursoCurrency: 'EUR',
      asOf: '2026-09-23T15:50:30.000Z',
    });
    await route.fulfill({
      json: {
        data: {
          id: 'preview-ui-test',
          asOf: '2026-09-23T15:50:30.000Z',
          errors: [],
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          rows: [
            {
              line: 2,
              isin: 'FR0011871128',
              quantity: '2',
              acquisitionCost: '20.01',
              costCurrency: 'EUR',
              platform: 'BoursoBank PEA',
              existingAssetId: null,
              quote: {
                name: 'ETF de test',
                symbol: 'TEST.PA',
                exchange: 'Paris',
                price: '12',
                currency: 'EUR',
                observedAt: new Date().toISOString(),
              },
            },
          ],
        },
      },
    });
  });
  await page.route('**/api/v1/securities/imports/preview-ui-test/confirm', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ confirmed: true });
    await route.fulfill({ json: { data: { id: 'preview-ui-test', created: 1, skipped: 0 } } });
  });
  await page.getByLabel('Nouveau compte / courtier').fill('BoursoBank PEA');
  await page.getByLabel('Fichier CSV Bourse').setInputFiles({
    name: 'export-positions-instantanees-23-09-2026_17-50-30.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByLabel('Date effective de l’inventaire (Europe/Paris)')).toHaveValue(
    '2026-09-23T17:50:30',
  );
  await expect(page.getByRole('button', { name: 'Analyser le CSV Bourse' })).toBeDisabled();
  await page.getByLabel('Je confirme la date effective de cet inventaire').check();
  await page.getByRole('button', { name: 'Analyser le CSV Bourse' }).click();
  await expect(
    page.getByRole('heading', { name: 'Aperçu Bourse · 1 position(s) à créer' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Aperçu de l’import Bourse' })).toContainText(
    '20,01',
  );
  await expect(page.getByText('Enregistrement effectué.', { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  mkdirSync('.local/screenshots', { recursive: true });
  await page.screenshot({ path: '.local/screenshots/import-bourse-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
    false,
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({ path: '.local/screenshots/import-bourse-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Confirmer l’import Bourse' }).click();
  await expect(
    page.getByText(
      'Import terminé : 1 position(s) créée(s), 0 déjà présente(s). Les cours seront actualisés automatiquement.',
    ),
  ).toBeVisible();
});
