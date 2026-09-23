import { chromium, type Browser } from 'playwright';
import { addressSchema, DeBankError } from './debank';
import { decimal as d, precise } from '@/domain/money';
import type { DefiPosition, WalletData, WalletToken } from '@/shared/wallets';

type Cell = {
  text: string;
  tokens: { href: string; symbol: string; amount: string; value: string }[];
};
export type PublicDocument = {
  addressText: string;
  total: string;
  updated: string;
  walletTotal: string;
  tokens: Cell[][];
  projects: {
    id: string;
    name: string;
    total: string;
    panels: { kind: string; tables: { headers: string[]; rows: Cell[][] }[] }[];
  }[];
  chains: { id: string; name: string; value: string }[];
};

// Deliberately reads rendered DOM only: no page state, internal API, wallet session or request signature.
// The string keeps the reader independent of the server's TypeScript/bundler transformations.
export const publicDocumentScript = String.raw`(() => {
  const txt = el => el ? el.innerText.trim() : '';
  const cell = el => ({ text: txt(el), tokens: [...el.querySelectorAll('a[href^="/token/"]')].map(a => ({
    href: a.getAttribute('href'), symbol: txt(a),
    amount: [...a.parentElement.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim(),
    value: txt(a.parentElement).match(/\(<?\$[\d,.]+\)/)?.[0] || '',
  })) });
  const wallet = document.getElementById('Wallet')?.parentElement;
  return {
    addressText: txt(document.querySelector('[class*="HeaderInfo_userInfoMain"]')),
    total: [...(document.querySelector('[class*="HeaderInfo_totalAssetInner"]')?.childNodes || [])].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(),
    updated: document.body.innerText.match(/Data updated\s+[\s\S]{0,80}?ago/)?.[0].replace(/\s+/g, ' ') || '',
    walletTotal: txt(wallet?.querySelector('.projectTitle-number')),
    tokens: [...(wallet?.querySelectorAll('.db-table-row') || [])].map(r => [...r.querySelectorAll('.db-table-cell')].map(cell)),
    projects: [...document.querySelectorAll('[class*="Project_project__"]')].map(p => {
      const title = p.querySelector('[class*="ProjectTitle_projectTitle__"]');
      return { id: title?.id || '', name: txt(title?.querySelector('[class*="ProjectTitle_name__"]')), total: txt(title?.querySelector('.projectTitle-number')),
        panels: [...p.querySelectorAll('[class*="Panel_container__"]')].map(panel => ({
          kind: txt(panel.querySelector('[class*="BookMark_bookmark__"]')),
          tables: [...panel.querySelectorAll('[class*="table_header__"]')].map(h => ({
            headers: [...h.children].map(txt),
            rows: [...(h.nextElementSibling?.querySelectorAll('[class*="table_contentRow__"]') || [])].map(r => [...r.children].map(cell)),
          })),
        })),
      };
    }),
    chains: [...document.querySelectorAll('[class*="AssetsOnChain_chainInfo__"]')].map(el => ({
      name: txt(el.querySelector('[class*="AssetsOnChain_chainName__"]')),
      id: (el.parentElement?.querySelector('img')?.getAttribute('src') || '').match(/image\/chain\/logo_url\/([^/]+)/)?.[1] || txt(el.querySelector('[class*="AssetsOnChain_chainName__"]')),
      value: txt(el.querySelector('[class*="AssetsOnChain_usdValue__"]')),
    })),
  };
})()`;

export function publicNumber(value: string): string | null {
  let input = value.trim().replace(/[,$\s()]/g, '');
  // A less-than value is a bound, not zero or an exact price.
  if (input.startsWith('<')) return null;
  const tiny = input.match(/^(-?)0\.0([₀₁₂₃₄₅₆₇₈₉]+)(\d+)$/);
  if (tiny) {
    const count = Number([...tiny[2]].map((c) => '₀₁₂₃₄₅₆₇₈₉'.indexOf(c)).join(''));
    if (count > 100) return null;
    input = `${tiny[1]}0.${'0'.repeat(count)}${tiny[3]}`;
  }
  if (!/^-?\d+(\.\d+)?$/.test(input)) return null;
  const result = d(input);
  return result.abs().lt('1e19') ? result.toFixed() : null;
}
function tokensOf(cell: Cell | undefined, rowValue: string | null = null): WalletToken[] {
  return (cell?.tokens || []).map((t) => {
    const [, , chain, ...id] = t.href.split('/');
    return {
      id: id.join('/'),
      chain: chain === 'undefined' ? 'app' : chain,
      symbol: t.symbol,
      name: t.symbol,
      amount: publicNumber(t.amount),
      priceUsd: null,
      valueUsd: t.value ? publicNumber(t.value) : cell!.tokens.length === 1 ? rowValue : null,
      ...(t.value.includes('<') ? { valueText: t.value.replace(/[()]/g, '') } : {}),
    };
  });
}
export function normalizePublicDocument(doc: PublicDocument, address: string): WalletData {
  const totalUsd = publicNumber(doc.total);
  if (
    totalUsd === null ||
    !doc.updated ||
    !doc.addressText.toLowerCase().includes(address.toLowerCase())
  )
    throw new DeBankError('FORMAT');
  const tokens: WalletToken[] = doc.tokens.map((cells) => {
    if (cells.length !== 4 || cells[0].tokens.length !== 1) throw new DeBankError('FORMAT');
    const token = tokensOf(cells[0])[0];
    const amount = publicNumber(cells[2].text);
    if (amount === null && !cells[2].text.includes('<')) throw new DeBankError('FORMAT');
    const price = publicNumber(cells[1].text);
    return {
      ...token,
      amount,
      priceUsd: price && d(price).gt(0) ? price : null,
      valueUsd: publicNumber(cells[3].text),
      ...(cells[3].text.includes('<') ? { valueText: cells[3].text } : {}),
    };
  });
  const positions: DefiPosition[] = [];
  let rewardsValue = d(0);
  const warnings: string[] = [];
  for (const project of doc.projects) {
    if (!project.id || !project.name) throw new DeBankError('FORMAT');
    let parsed = 0;
    for (const [panelIndex, panel] of project.panels.entries()) {
      const lending = panel.tables.some((t) => ['Supplied', 'Borrowed'].includes(t.headers[0]));
      const combined: DefiPosition = {
        id: `${project.id}:${panelIndex}`,
        protocol: project.name,
        chain: '',
        kind: panel.kind || 'Position',
        description: null,
        netUsd: '0',
        assetsUsd: '0',
        debtUsd: '0',
        observedAt: null,
        unlockAt: null,
        supplies: [],
        rewards: [],
        borrows: [],
      };
      let read = 0;
      for (const [tableIndex, table] of panel.tables.entries()) {
        const balance = table.headers.indexOf('Balance'),
          value = table.headers.indexOf('USD Value'),
          reward = table.headers.indexOf('Rewards');
        if (balance < 0 || value < 0) {
          warnings.push(`${project.name} : détail non reconnu`);
          continue;
        }
        for (const [rowIndex, row] of table.rows.entries()) {
          if (!row[value]) throw new DeBankError('FORMAT');
          const bounded = row[value].text.includes('<');
          const net = publicNumber(row[value].text);
          if (net === null && !bounded) {
            warnings.push(`${project.name} : valeur non disponible`);
            continue;
          }
          const borrow = table.headers[0] === 'Borrowed';
          const rewardOnly = table.headers[0] === 'Rewards' || panel.kind === 'Rewards';
          const supplies = tokensOf(row[balance], reward < 0 ? net : null);
          const rewards = rewardOnly ? supplies : reward >= 0 ? tokensOf(row[reward]) : [];
          rewardsValue = rewardsValue.add(
            rewardOnly ? net || 0 : rewards.reduce((s, t) => s.add(t.valueUsd || 0), d(0)),
          );
          if (lending) {
            combined[borrow ? 'borrows' : rewardOnly ? 'rewards' : 'supplies'].push(...supplies);
            combined[borrow ? 'debtUsd' : 'assetsUsd'] = d(
              combined[borrow ? 'debtUsd' : 'assetsUsd'],
            )
              .add(net || 0)
              .toFixed();
            combined.netUsd = d(combined.netUsd)
              .add(borrow ? d(net || 0).neg() : net || 0)
              .toFixed();
            if (bounded) combined.approximate = true;
          } else {
            positions.push({
              ...combined,
              id: `${project.id}:${panelIndex}:${tableIndex}:${rowIndex}`,
              description: table.headers[0] === '' ? row[0]?.text || null : null,
              chain: supplies[0]?.chain || (project.id.startsWith('_') ? 'app' : 'eth'),
              supplies: rewardOnly ? [] : supplies,
              rewards,
              netUsd: net || '0',
              assetsUsd: net || '0',
              approximate: bounded,
              ...(bounded ? { valueText: row[value].text } : {}),
            });
          }
          read++;
          parsed++;
        }
      }
      if (lending && read) {
        combined.chain =
          [...combined.supplies, ...combined.borrows, ...combined.rewards][0]?.chain || 'unknown';
        positions.push(combined);
      }
    }
    if (!parsed) {
      const net = publicNumber(project.total);
      if (net === null) throw new DeBankError('FORMAT');
      warnings.push(`${project.name} : total du protocole, détail indisponible`);
      positions.push({
        id: project.id,
        protocol: project.name,
        kind: 'Position',
        chain: 'unknown',
        description: 'Détail non reconnu ; total public du protocole conservé.',
        netUsd: net,
        assetsUsd: net,
        debtUsd: '0',
        observedAt: null,
        unlockAt: null,
        supplies: [],
        rewards: [],
        borrows: [],
        approximate: true,
      });
    }
  }
  if (d(totalUsd).gt(1) && !tokens.length && !positions.length) throw new DeBankError('FORMAT');
  const liquid = tokens.reduce((s, t) => s.add(t.valueUsd || 0), d(0));
  const defi = positions.reduce((s, p) => s.add(p.netUsd), d(0));
  return {
    source: 'DEBANK_PUBLIC',
    rounded: true,
    updatedLabel: doc.updated || 'Date non fournie par la page',
    warnings: [...new Set(warnings)],
    totalUsd,
    tokens,
    positions,
    liquidUsd: precise(liquid),
    defiUsd: precise(defi),
    debtUsd: precise(positions.reduce((s, p) => s.add(p.debtUsd), d(0))),
    rewardsUsd: precise(rewardsValue),
    reconciliationUsd: precise(d(totalUsd).sub(liquid).sub(defi)),
    chains: doc.chains.map((c) => ({
      id: c.id,
      name: c.name,
      valueUsd: publicNumber(c.value) || '0',
    })),
  };
}

export async function fetchDeBankPublic(address: string): Promise<WalletData> {
  const id = addressSchema.parse(address);
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true, timeout: 20_000 });
  } catch {
    throw new DeBankError('BROWSER');
  }
  const deadline = setTimeout(() => {
    void browser.close().catch(() => {});
  }, 120_000);
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      locale: 'en-US',
    });
    page.setDefaultTimeout(8_000);
    const response = await page.goto(`https://debank.com/profile/${id}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    if (response && [401, 403, 429].includes(response.status()))
      throw new DeBankError('PUBLIC_BLOCKED');
    await page.locator('[class*="HeaderInfo_totalAssetInner"]').waitFor({ timeout: 30_000 });
    // The total can appear before the portfolio has finished loading.
    await page.locator('#Wallet').waitFor({ timeout: 20_000 });
    // DeBank first displays cash alone while its DeFi requests are still in flight.
    // Never persist that intermediate total as a successful portfolio observation.
    await page
      .getByText(/Data updated/)
      .first()
      .waitFor({ timeout: 60_000 });
    const reject = page.getByRole('button', { name: 'Reject', exact: true });
    if (await reject.isVisible()) await reject.click();
    const projects = page.getByText(/Protocols with small deposits are not displayed\.\s*Show all/);
    if (await projects.count()) await projects.first().click();
    const smallTokens = page.getByText(/Tokens with small balances are not displayed\.\s*Show all/);
    if (await smallTokens.count()) await smallTokens.first().click();
    const chains = page.getByText(/^Unfold \d+ chains$/);
    if (await chains.count()) await chains.first().click();
    // Wait for React rendering of the expanded sections, without pressing any on-chain action.
    await page.waitForFunction(
      () =>
        !/Tokens with small balances are not displayed\.\s*Show all/.test(
          document.body.innerText,
        ) &&
        !/Protocols with small deposits are not displayed\.\s*Show all/.test(
          document.body.innerText,
        ) &&
        /Data updated/.test(document.body.innerText),
    );
    const publicDoc = (await page.evaluate(publicDocumentScript)) as PublicDocument;
    return normalizePublicDocument(publicDoc, id);
  } catch (error) {
    throw error instanceof DeBankError ? error : new DeBankError('PUBLIC_BLOCKED');
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}
