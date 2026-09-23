import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
// Reuse authenticated cookies within this worker instead of exhausting the login rate limit.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>();
async function login(page: Page, file = '.local/e2e-access.json') {
  const cookies = sessions.get(file);
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto('/dashboard');
  } else {
    const credentials = JSON.parse(readFileSync(file, 'utf8'));
    await page.goto('/login');
    await page.getByLabel('Adresse e-mail').fill(credentials.email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Ouvrir mon portefeuille' }).click();
    await expect(page).toHaveURL(/dashboard/);
    sessions.set(file, await page.context().cookies());
  }
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Patrimoine/);
}
test('parcours complet : connexion, actif, achat, prix, vente, snapshot et export', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/login/);
  await login(page);
  await page.getByRole('link', { name: 'Ajouter un actif' }).first().click();
  await page.getByLabel('Nom de l’actif').fill('Bitcoin de test');
  await page.getByLabel('Catégorie', { exact: true }).selectOption({ label: 'Cryptomonnaies' });
  await page.getByLabel('Quantité détenue').fill('2');
  await page.getByLabel('Coût d’acquisition total (€)').fill('202');
  await page.getByRole('button', { name: 'Enregistrer l’actif' }).click();
  await expect(page.getByRole('heading', { name: 'Bitcoin de test', exact: true })).toBeVisible();
  await page.getByLabel('Ajouter ou remplacer l’image').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: await sharp({ create: { width: 20, height: 20, channels: 3, background: '#6366f1' } })
      .png()
      .toBuffer(),
  });
  await expect(page.getByAltText('Visuel de l’actif')).toBeVisible();
  await page.getByLabel('Prix unitaire (EUR)').fill('140');
  await page.getByRole('button', { name: 'Enregistrer le prix' }).click();
  await expect(page.getByRole('status')).toContainText('Enregistrement effectué');
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await page.getByRole('link', { name: 'Nouvelle transaction', exact: true }).click();
  await page.getByLabel('Type d’opération').selectOption('SELL');
  await page.getByLabel('Quantité', { exact: true }).fill('1');
  await page.getByLabel('Prix unitaire', { exact: true }).fill('150');
  await page.getByLabel('Frais', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/transactions$/);
  const state = await (await page.request.get('/api/v1/state')).json();
  expect(state.data.totals.valueEur).toBe('287');
  expect(state.data.totals.realizedEur).toBe('46');
  await page.getByRole('link', { name: 'Modifier Ajustement initial Bitcoin de test' }).click();
  await page.getByLabel('Prix unitaire', { exact: true }).fill('110');
  await page.getByLabel('Motif de correction').fill('Correction du prix de test');
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/transactions$/);
  expect((await (await page.request.get('/api/v1/state')).json()).data.totals.realizedEur).toBe(
    '37',
  );
  await page.getByRole('link', { name: 'Tableau de bord', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer un snapshot' }).click();
  await expect(page.getByRole('status')).toContainText('Enregistrement effectué');
  await page.getByRole('link', { name: 'Historique', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Manuel', exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exporter l’historique' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('patrimoine-history.csv');
  await page.getByRole('link', { name: 'Paramètres', exact: true }).click();
  await page.getByLabel('Fichier CSV', { exact: true }).setInputFiles({
    name: 'import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'type,amount,currency,occurred_at,platform,external_reference\nDEPOSIT,50,EUR,2025-01-01T00:00:00Z,Personnel,e2e-cash-001',
    ),
  });
  await page.getByRole('button', { name: 'Vérifier et afficher l’aperçu' }).click();
  await expect(page.getByRole('heading', { name: 'Aperçu · 1 lignes valides' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmer l’import de 1 transactions' }).click();
  await expect(
    page.getByText('Import terminé. Les transactions sont dans votre journal.'),
  ).toBeVisible();
  expect((await (await page.request.get('/api/v1/state')).json()).data.totals.valueEur).toBe('337');
});
test('supprime depuis la fiche un actif encore détenu', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Ajouter un actif' }).first().click();
  await page.getByLabel('Nom de l’actif').fill('Actif à supprimer');
  await page.getByLabel('Quantité détenue').fill('2');
  await page.getByRole('button', { name: 'Enregistrer l’actif' }).click();
  await expect(page.getByRole('heading', { name: 'Actif à supprimer', exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('button', { name: 'Supprimer cet actif' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Cette action est irréversible');
  await page.getByRole('button', { name: 'Confirmer la suppression' }).click();
  await expect(page).toHaveURL(/assets$/);
  const state = await (await page.request.get('/api/v1/state')).json();
  expect(state.data.rows.some((row: { id: string }) => row.id === id)).toBe(false);
  expect(
    state.data.transactions.some((row: { assetId: string | null }) => row.assetId === id),
  ).toBe(false);
});
test('navigation mobile sans débordement de page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  for (const path of [
    '/dashboard',
    '/assets',
    '/transactions',
    '/history',
    '/settings',
    '/wallets',
  ]) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, `Débordement sur ${path}`).toBe(false);
  }
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('link', { name: 'Mes actifs', exact: false }).click();
  await expect(page).toHaveURL(/assets$/);
});
test('accessibilité des pages principales', async ({ page }) => {
  await login(page);
  for (const path of [
    '/dashboard',
    '/portfolio',
    '/assets',
    '/assets/new',
    '/transactions',
    '/transactions/new',
    '/history',
    '/settings',
    '/wallets',
  ]) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page).toHaveTitle(/Patrimoine/);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        description: v.description,
        nodes: v.nodes.map((n) => n.target),
      })),
      `Accessibilité ${path}`,
    ).toEqual([]);
  }
});
test('wallet par adresse : configuration privée, repère, pause et retrait', async ({ page }) => {
  await login(page);
  const address = `0x${'c'.repeat(40)}`;
  await page.goto(`/wallets?address=${address}&reference=1000`);
  await expect(page.getByLabel('Adresse publique ou profil DeBank')).toHaveValue(address);
  await page.getByLabel('Nom du wallet (facultatif)').fill('Wallet navigateur');
  await page.getByRole('button', { name: 'Ajouter le wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Wallet navigateur', exact: true })).toBeVisible();
  await expect(page.getByText('Première synchronisation programmée…')).toBeVisible();
  await expect(page.getByText('Comparaison après synchronisation')).toBeVisible();
  await expect(page.getByLabel('Clé API DeBank Cloud')).toHaveCount(0);
  const state = await (await page.request.get('/api/v1/state')).json();
  expect(state.data.onchain.config).toMatchObject({
    mode: 'PUBLIC',
    configured: true,
    hasKey: false,
  });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Synchronisation en pause', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Retirer Wallet navigateur' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Confirmer la suppression', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Wallet navigateur', exact: true })).toHaveCount(
    0,
  );
});
test('wallet synchronisé : tokens, dettes, DeFi et affichage mobile', async ({ page }) => {
  await login(page, '.local/e2e-wallet-access.json');
  const cryptoCard = page.locator('a.category-card[href="/categories/crypto"]');
  await expect(cryptoCard).toContainText('724,00');
  await cryptoCard.click();
  await expect(page.locator('.category-metrics .metric').first()).toContainText('724,00');
  await expect(page.getByText('Données d’acquisition incomplètes')).toBeVisible();
  await page.goto('/wallets');
  await expect(
    page.getByRole('heading', { name: 'Wallet synchronisé', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Lecture publique · total arrondi par DeBank')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Protocol fixture', exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Tokens du wallet' }).getByRole('cell', { name: /USDC/ }),
  ).toBeVisible();
  const smallValues = page.getByRole('switch', { name: 'Afficher les valeurs de moins de 1 €' });
  await expect(smallValues).not.toBeChecked();
  await expect(page.getByRole('cell', { name: /DUST/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Dust fixture' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: /UNKNOWN/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Protocol fixture' })).toHaveCount(1);
  await smallValues.check();
  await expect(page.getByRole('cell', { name: /DUST/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dust fixture' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Protocol fixture' })).toHaveCount(2);
  await smallValues.uncheck();
  await expect(page.getByRole('cell', { name: /DUST/ })).toHaveCount(0);
  const state = await (await page.request.get('/api/v1/state')).json();
  expect(state.data.onchain.valueUsd).toBe('905');
  expect(state.data.totals.unrealizedEur).toBeNull();
  mkdirSync('.local/screenshots', { recursive: true });
  await page.screenshot({ path: '.local/screenshots/wallets-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
  await page.screenshot({ path: '.local/screenshots/wallets-mobile.png', fullPage: true });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await page.getByLabel('Rechercher un token ou protocole').fill('UNKNOWN');
  await smallValues.check();
  await expect(page.getByRole('cell', { name: /UNKNOWN/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Protocol fixture', exact: true })).toHaveCount(0);
});
