import { decimal as d } from '@/domain/money';
import type { WalletData } from '@/shared/wallets';
const chains: Record<string, string> = {
  eth: 'ethereum',
  arb: 'arbitrum',
  op: 'optimism',
  bsc: 'binance-smart-chain',
  matic: 'polygon',
  avax: 'avalanche',
  xdai: 'gnosis',
  ftm: 'fantom',
};
const chain = (value: string) => chains[value] || value;
const protocol = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/v\d+$/, '');
// Absence is not proof of an unsupported protocol (the owner may have withdrawn).
// Surface it without inventing a balance or silently claiming equivalent coverage.
export function compareWalletCoverage(previous: WalletData, current: WalletData) {
  const warnings: string[] = [];
  for (const c of previous.chains) {
    if (d(c.valueUsd).abs().gte(50) && !current.chains.some((n) => chain(n.id) === chain(c.id)))
      warnings.push(
        `Réseau précédemment valorisé absent : ${c.name}. Couverture ou mouvement à vérifier.`,
      );
  }
  for (const p of previous.positions) {
    if (
      d(p.assetsUsd).abs().add(d(p.debtUsd).abs()).gte(50) &&
      !current.positions.some(
        (n) => chain(n.chain) === chain(p.chain) && protocol(n.protocol) === protocol(p.protocol),
      )
    )
      warnings.push(
        `Position précédemment valorisée absente : ${p.protocol} (${p.chain}). Couverture ou retrait à vérifier.`,
      );
  }
  for (const t of previous.tokens) {
    if (
      t.valueUsd !== null &&
      d(t.valueUsd).abs().gte(50) &&
      ![...current.tokens, ...current.positions.flatMap((p) => [...p.supplies, ...p.rewards])].some(
        (n) =>
          chain(n.chain) === chain(t.chain) && n.symbol.toLowerCase() === t.symbol.toLowerCase(),
      )
    )
      warnings.push(
        `Actif précédemment valorisé absent : ${t.symbol} (${t.chain}). Couverture ou transfert à vérifier.`,
      );
  }
  return [...new Set(warnings)];
}
