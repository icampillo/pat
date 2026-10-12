import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createUser } from '../../src/server/provision';
import { db } from '../../src/server/db';

const email = `e2e-estate-${randomUUID()}@example.test`,
  password = randomUUID();
test.beforeAll(async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Base de test requise');
  process.env.DATABASE_URL = url;
  await createUser('Immobilier E2E', email, password);
});
test.afterAll(async () => {
  await db().$disconnect();
});
test('creates and edits a rental property, shows net wealth and paginated amortization on mobile', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ouvrir mon portefeuille' }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto('/assets/new');
  await page.getByLabel('Catégorie', { exact: true }).selectOption({ label: 'Immobilier' });
  await page.getByLabel('Nom du bien', { exact: true }).fill('Appartement Marseille');
  await page.getByLabel('Ville', { exact: true }).fill('Marseille');
  await page.getByLabel('Valeur actuelle du bien entier').fill('300000');
  await page.getByLabel('Date d’acquisition', { exact: true }).fill('2020-01-01');
  await page.getByLabel('Prix d’acquisition', { exact: true }).fill('280000');
  await page.getByLabel('Frais d’acquisition / notaire', { exact: true }).fill('20000');
  await expect(page.getByLabel('Loyer mensuel hors charges')).toHaveCount(0);
  await page.getByLabel('Crédit immobilier', { exact: true }).selectOption('yes');
  await page.getByLabel('Montant emprunté attribué', { exact: true }).fill('180000');
  await page.getByLabel('Apport personnel', { exact: true }).fill('120000');
  await page.getByLabel('Taux nominal annuel (%)', { exact: true }).fill('3');
  await page.getByLabel('Durée (mois)', { exact: true }).fill('240');
  await page
    .getByLabel('Date de début du prêt', { exact: true })
    .fill(new Date().toISOString().slice(0, 10));
  await expect(page.locator('output')).toContainText('998,28');
  await page.getByLabel('Usage', { exact: true }).selectOption('RENTAL');
  await page.getByLabel('Loyer mensuel hors charges', { exact: true }).fill('1500');
  await page.getByLabel('Charges mensuelles non récupérables', { exact: true }).fill('100');
  await page.getByLabel('Taxe foncière annuelle', { exact: true }).fill('1200');
  await page.getByRole('button', { name: 'Enregistrer le bien' }).click();
  await expect(page.locator('h1')).toHaveText('Appartement Marseille');
  await expect(page.locator('.metrics .metric').last()).toContainText('120 000');
  await expect(
    page.getByRole('heading', { name: 'Location · estimation avant fiscalité' }),
  ).toBeVisible();
  const schedule = page.getByRole('region', { name: 'Échéancier du crédit', exact: true });
  await expect(schedule.locator('tbody tr')).toHaveCount(12);
  await page.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(schedule.locator('tbody tr').first().locator('td').first()).toHaveText('13');
  const detailUrl = page.url();
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  await expect(page.getByLabel('Loyer mensuel hors charges', { exact: true })).toHaveValue('1500');
  await page.getByLabel('Usage', { exact: true }).selectOption('PRIMARY_RESIDENCE');
  await expect(page.getByLabel('Loyer mensuel hors charges')).toHaveCount(0);
  await page.getByLabel('Valeur actuelle du bien entier').fill('310000');
  await page.getByRole('button', { name: 'Enregistrer le bien' }).click();
  await expect(page.locator('.metrics .metric').last()).toContainText('130 000');
  await expect(
    page.getByRole('heading', { name: 'Location · estimation avant fiscalité' }),
  ).toHaveCount(0);
  await page.goto('/dashboard');
  const card = page.locator('a[data-testid="investment-card"][href="/categories/real-estate"]');
  await expect(card).toContainText('130 000');
  await expect(card).toContainText('310 000');
  await expect(card).toContainText('180 000');
  await card.click();
  await expect(page.locator('h1')).toHaveText('Immobilier');
  await expect(
    page.getByRole('link', { name: 'Appartement Marseille', exact: true }),
  ).toBeVisible();
  for (const period of ['7j', '30j', '90j', '1 an', 'Tout']) {
    await page.getByRole('button', { name: period, exact: true }).click();
    await expect(page.getByRole('button', { name: period, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  mkdirSync('.local/screenshots', { recursive: true });
  for (const [name, url] of [
    ['category', '/categories/real-estate'],
    ['detail', detailUrl],
  ]) {
    await page.goto(url);
    await expect(page.locator('h1')).toHaveText(
      name === 'category' ? 'Immobilier' : 'Appartement Marseille',
    );
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByText('Chargement de votre patrimoine…')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
        false,
      );
      await page.screenshot({
        path: `.local/screenshots/real-estate-${name}-${width}.png`,
        fullPage: true,
      });
    }
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  }
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Modifier le bien immobilier' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
    false,
  );
  await page.screenshot({ path: '.local/screenshots/real-estate-form-mobile.png', fullPage: true });
  await page.getByLabel('Valeur actuelle du bien entier').fill('260000');
  await page.getByLabel('Prix d’acquisition', { exact: true }).fill('250000');
  await page.getByLabel('Montant emprunté attribué', { exact: true }).fill('240000');
  await page.getByLabel('Apport personnel', { exact: true }).fill('10000');
  await page.getByLabel('Date de début du prêt', { exact: true }).fill('2020-01-01');
  await page.getByLabel('Capital restant dû actuel', { exact: true }).fill('225000');
  await page.getByLabel('Date du relevé de capital', { exact: true }).fill('2021-01-31');
  await page.getByRole('button', { name: 'Enregistrer le bien' }).click();
  await expect(page.locator('.metrics .metric').last()).toContainText('35 000');
  await expect(page.locator('.metrics .metric').first()).toContainText('15 000');
  await expect(page.getByRole('region', { name: 'Relevés de capital restant dû' })).toContainText(
    '225 000',
  );
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter un crédit', exact: true }).click();
  const secondLoan = page.getByRole('group', { name: 'Crédit 2', exact: true });
  await secondLoan.getByLabel('Montant emprunté attribué', { exact: true }).fill('20000');
  await secondLoan.getByLabel('Apport personnel', { exact: true }).fill('0');
  await secondLoan.getByLabel('Taux nominal annuel (%)', { exact: true }).fill('0');
  await secondLoan.getByLabel('Durée (mois)', { exact: true }).fill('120');
  await secondLoan.getByLabel('Date de début du prêt', { exact: true }).fill('2020-01-01');
  await secondLoan.getByLabel('Capital restant dû actuel', { exact: true }).fill('10000');
  await secondLoan.getByLabel('Date du relevé de capital', { exact: true }).fill('2021-01-31');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
    false,
  );
  await page.getByRole('button', { name: 'Enregistrer le bien' }).click();
  await expect(page.locator('.metrics .metric').last()).toContainText('25 000');
  await page.getByLabel('Crédit affiché').selectOption('1');
  await expect(page.getByRole('region', { name: 'Relevés de capital restant dû' })).toContainText(
    '10 000',
  );
  await page.reload();
  await expect(page.locator('.metrics .metric').last()).toContainText('25 000');
  await page.goto('/dashboard');
  await expect(card).toContainText('25 000');
  await expect(card).toContainText('235 000');
  await card.click();
  await expect(page.locator('.category-metrics')).toContainText('Capital déjà remboursé');
  await expect(page.locator('.category-metrics')).toContainText('25 000');
  await expect(page.locator('.category-metrics progress')).toHaveAttribute(
    'value',
    String((25000 / 260000) * 100),
  );
  await page.screenshot({
    path: '.local/screenshots/real-estate-manual-multiple.png',
    fullPage: true,
  });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});
