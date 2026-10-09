import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { workspaceFixture } from '../fixtures/workspace';

// Isolate export from the independently tested market synchronization.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/market/refresh', () => {});
});

test('generates locally, copies the exact visible prompt, and restores focus on close', async ({
  page,
  context,
}) => {
  const state = workspaceFixture();
  let reads = 0;
  const unexpected: string[] = [];
  await page.route('**/api/v1/state', (route) => {
    reads++;
    return route.fulfill({ json: { data: state } });
  });
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:3002/')) unexpected.push(request.url());
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: 'Exporter le prompt IA', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Analyser mon patrimoine avec une IA' });
  await expect(dialog).toBeVisible();
  const prompt = await dialog.getByLabel('Prompt généré').inputValue();
  expect(prompt).toContain('Bitcoin test');
  expect(prompt).toContain('Valeur totale : 1 000 EUR');
  expect(prompt).not.toMatch(/undefined|null|NaN/);
  await expect(dialog).toContainText('Aucune donnée n’est envoyée automatiquement à une IA.');
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual(
    [],
  );
  await dialog.getByRole('button', { name: 'Copier le prompt', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Prompt copié', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(reads).toBe(1);
  expect(unexpected).toEqual([]);
});

test('handles clipboard rejection with a manual selection fallback on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/state', (route) =>
    route.fulfill({ json: { data: workspaceFixture() } }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
      configurable: true,
    });
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Exporter le prompt IA', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Copier le prompt', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Copie automatique indisponible');
  await dialog.getByRole('button', { name: 'Sélectionner le texte' }).click();
  const textarea = dialog.getByLabel('Prompt généré');
  expect(
    await textarea.evaluate(
      (element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart,
    ),
  ).toBe((await textarea.inputValue()).length);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Fermer l’analyse' }).click();
  await page.getByRole('button', { name: 'Exporter le prompt IA', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});
