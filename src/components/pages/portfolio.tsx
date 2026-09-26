'use client';
import { PortfolioBreakdown } from '@/components/portfolio-breakdown';
import { WalletSummary } from '@/components/wallets';
import type { AppState } from '@/shared/types';
import { ArrowLeftRight, Coins, TrendingUp, Wallet } from 'lucide-react';

import { AssetList } from '@/components/assets/asset-list';
import { useWorkspace } from '@/components/workspace/context';
import { Metric, money } from '@/components/workspace/display';
import { PageHeading } from '@/components/workspace/page-heading';

export function PortfolioPage({ state }: { state: AppState }) {
  const { currency } = useWorkspace();
  const total = currency === 'EUR' ? state.totals.valueEur : state.totals.valueUsd;
  return (
    <>
      <PageHeading view="portfolio" title="Mon portefeuille" />
      <>
        <div className="metrics">
          <Metric
            title="Patrimoine total"
            value={money(total, currency)}
            note="Actifs et liquidités"
            icon={<Wallet size={18} />}
            accent
          />
          <Metric
            title="Apports nets (EUR)"
            value={money(state.totals.netFlowsEur)}
            note="Apports moins retraits"
            icon={<ArrowLeftRight size={18} />}
          />
          <Metric
            title="Gains réalisés (EUR)"
            value={money(state.totals.realizedEur)}
            note="Sur les cessions enregistrées"
            icon={<TrendingUp size={18} />}
          />
          <Metric
            title="Revenus (EUR)"
            value={money(state.totals.incomeEur)}
            note="Dividendes et récompenses"
            icon={<Coins size={18} />}
          />
        </div>
        <AssetList state={state} currency={currency} />
      </>
      <WalletSummary state={state} currency={currency} />
      <PortfolioBreakdown state={state} currency={currency} />
    </>
  );
}
