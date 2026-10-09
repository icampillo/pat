import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { applicationUiFixture } from '../fixtures/application-ui';

async function mockState(page: Page, state = applicationUiFixture()) {
  await page.route('**/api/v1/market/refresh', () => {});
  await page.route('**/api/v1/state', route => route.fulfill({ json: { data: state } }));
  await page.route('**/api/v1/assets/*/prices', route => route.fulfill({ json: { data: [] } }));
}
async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
}
async function inspect(page: Page, path: string, title: string, axe = true) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await noOverflow(page);
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Patrimoine Inter');
  if (axe) await accessible(page);
  await page.screenshot({ path: test.info().outputPath(path.replace(/[^a-z0-9]/gi, '-') + '.png'), fullPage: true });
}
const mainPages = [
  ['/portfolio', 'Portefeuille'],
  ['/categories/stocks', 'Bourse'],
  ['/activity', 'Activité · Transactions'],
  ['/activity?view=history', 'Activité · Historique du patrimoine'],
  ['/wallets', 'Wallets DeFi'],
  ['/settings', 'Paramètres'],
  ['/assets/property', 'Appartement'],
];
const categories = [
  ['crypto','Cryptomonnaies'], ['precious-metals','Métaux précieux'], ['real-estate','Immobilier'],
  ['pokemon','Pokémon'], ['one-piece','One Piece'], ['other','Autres'],
];
for (const width of [1440, 768, 375]) {
  test(`shared design, main screens and accessibility at ${width}px`, async ({page}) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockState(page);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const [path, title] of mainPages) await inspect(page,path,title);
    expect(errors).toEqual([]);
  });
  test(`category and asset variants at ${width}px`, async ({page}) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await mockState(page);
    for (const [slug,title] of categories) await inspect(page, '/categories/'+slug, title);
    for (const [id,title] of [['asset-0','Bitcoin'],['asset-1','ETF Monde'],['asset-2','Or'],['pokemon','Pokémon test'],['one_piece','One Piece test'],['other','Autres test']]) {
      await inspect(page, '/assets/'+id,title);
    }
  });
  test(`forms, financial variants and authentication at ${width}px`, async ({page}) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await mockState(page);
    for (const key of ['CRYPTO','SECURITIES','METALS','REAL_ESTATE','POKEMON','ONE_PIECE','OTHER']) {
      await inspect(page, '/assets/new?category='+key, 'Ajouter un actif');
    }
    await inspect(page,'/transactions/new','Nouvelle transaction');
    await inspect(page,'/transactions/tx-ui','Modifier la transaction');
    await inspect(page,'/transactions/inventory-ui','Modifier la transaction');
    await page.goto('/login');
    await expect(page.getByRole('heading', { name:'Heureux de vous retrouver.' })).toBeVisible();
    await accessible(page);
    await noOverflow(page);
    await page.screenshot({ path:test.info().outputPath('login.png'), fullPage:true });
    await page.goto('/not-a-page');
    await expect(page.getByRole('heading', { name:'Page introuvable' })).toBeVisible();
    await noOverflow(page);
    await accessible(page);
    await page.screenshot({ path:test.info().outputPath('not-found.png'), fullPage:true });
  });
}
test('category identity, filters, navigation and chart geometry stay consistent', async ({page}) => {
  await mockState(page);
  await page.goto('/portfolio');
  const badge = page.locator('.category-pill').filter({hasText:'Bourse'}).first();
  expect(await badge.evaluate(el => getComputedStyle(el).getPropertyValue('--category-color').trim())).toBe('#ee775e');
  await page.getByLabel('Filtrer par catégorie').selectOption('stocks');
  await expect(page.getByRole('region',{name:'Actifs du portefeuille'}).getByRole('link',{name:/Bitcoin/})).toHaveCount(0);
  await page.getByRole('link',{name:/ETF Monde/}).first().click();
  await expect(page.getByRole('heading',{name:'ETF Monde',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Bourse',exact:true}).click();
  const chart=page.getByRole('img',{name:'Évolution de la valeur : Bourse'});
  const box=await chart.boundingBox();
  await chart.hover();
  expect(await chart.boundingBox()).toEqual(box);
  await expect(chart.locator('.recharts-area-curve')).toHaveAttribute('stroke','#ee775e');
  await page.getByRole('button',{name:'Tout',exact:true}).click();
  expect(await chart.boundingBox()).toEqual(box);
  await page.getByRole('link',{name:'Ajouter un actif',exact:true}).click();
  await expect(page.getByLabel('Catégorie',{exact:true})).toHaveValue('stocks');
});

for (const width of [1440,375]) {
  test(`wallet dialog, focus, deletion confirmation and navigation at ${width}px`,async ({page}) => {
    await page.setViewportSize({width,height:812});
    await mockState(page);
    await page.goto('/wallets');
    const trigger=page.getByRole('button',{name:'Ajouter une adresse'});
    await trigger.click();
    const dialog=page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByText('Options de suivi et de comparaison').click();
    await accessible(page);
    await noOverflow(page);
    await page.screenshot({path:test.info().outputPath('wallet-dialog.png'),fullPage:true});
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.getByLabel('Détails et actions de Wallet test').click();
    await page.getByRole('button',{name:'Retirer Wallet test'}).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await accessible(page);
    await page.getByRole('button',{name:'Annuler',exact:true}).click();
    if(width===375){
      await page.getByRole('button',{name:'Plus : ouvrir la navigation'}).click();
      await accessible(page);
      await page.getByRole('dialog').getByRole('link',{name:'Paramètres'}).click();
      await expect(page.getByRole('heading',{name:'Paramètres',exact:true})).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });
}
test('asset and transaction forms retain their save contracts and error feedback', async ({page}) => {
  await mockState(page);
  let assetSaved=false;
  await page.route('**/api/v1/assets',async route=>{
    expect(route.request().postDataJSON()).toMatchObject({name:'Nouvel actif',categoryId:'crypto',quantity:'2',acquisitionCost:'200'});
    assetSaved=true;
    await route.fulfill({json:{data:{id:'asset-0'}}});
  });
  await page.goto('/assets/new?category=CRYPTO');
  await page.getByLabel('Nom de l’actif',{exact:true}).fill('Nouvel actif');
  await page.getByLabel('Quantité détenue',{exact:true}).fill('2');
  await page.getByLabel('Coût d’acquisition total (€)',{exact:true}).fill('200');
  await page.getByRole('button',{name:'Enregistrer l’actif',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Bitcoin',exact:true})).toBeVisible();
  expect(assetSaved).toBe(true);
  await page.getByRole('button',{name:'Modifier',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Modifier la fiche'})).toBeVisible();
  await noOverflow(page);
  await page.route('**/api/v1/transactions',route=>route.fulfill({status:422,json:{error:{message:'Saisie à vérifier (test)'}}}));
  await page.goto('/transactions/new?asset=asset-0');
  await page.getByLabel('Quantité',{exact:true}).fill('1');
  await page.getByLabel('Prix unitaire',{exact:true}).fill('100');
  await page.getByRole('button',{name:'Enregistrer la transaction'}).click();
  await expect(page.getByRole('alert')).toContainText('Saisie à vérifier');
  await accessible(page);
});
test('empty states, initial error and reduced-motion loading are readable on mobile',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.emulateMedia({reducedMotion:'reduce'});
  const state=applicationUiFixture();
  state.rows=[];state.transactions=[];state.snapshots=[];state.onchain.wallets=[];
  await mockState(page,state);
  for(const [path,title] of [['/portfolio','Portefeuille'],['/activity','Activité · Transactions'],['/activity?view=history','Activité · Historique du patrimoine'],['/wallets','Wallets DeFi']])await inspect(page,path,title);
  await page.route('**/api/v1/state',route=>route.fulfill({status:503,json:{error:{message:'Service temporairement indisponible'}}}));
  await page.goto('/portfolio');
  await expect(page.getByRole('alert')).toContainText('Service temporairement indisponible');
  await accessible(page);
  await noOverflow(page);
});
