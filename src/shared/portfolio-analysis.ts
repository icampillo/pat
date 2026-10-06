export type AnalysisPerformance = {
  percentage: number;
  from: string;
  to: string;
  method: 'MODIFIED_DIETZ';
};

export interface PortfolioAnalysisPosition {
  id: string;
  name: string;
  symbol?: string;
  category: string;
  type?: string;
  quantity?: number;
  currentPrice?: number;
  priceCurrency?: string;
  priceDate?: string;
  currentValue?: number;
  portfolioWeight?: number;
  averageBuyPrice?: number;
  costBasis?: number;
  pnl?: { amount?: number; percentage?: number };
  wallet?: {
    label: string;
    chain?: string;
    protocol?: string;
    assetsValue?: number;
    debtValue?: number;
    unlockAt?: string;
    tokens: {
      role: 'Dépôt' | 'Emprunt' | 'Récompense';
      name: string;
      symbol: string;
      chain: string;
      quantity?: number;
      currentValue?: number;
    }[];
  };
  notes: string[];
}

export interface PortfolioAnalysisContext {
  generatedAt: string;
  valuedAt: string;
  /** Values, costs and P&L use this currency; quotes retain their own currency. */
  baseCurrency: 'EUR' | 'USD';
  portfolio: {
    totalValue?: number;
    performance?: { d30?: AnalysisPerformance; ytd?: AnalysisPerformance };
    allocationByCategory: { category: string; value?: number; percentage?: number }[];
    concentration: {
      top1Percentage?: number;
      top3Percentage?: number;
      top5Percentage?: number;
      top10Percentage?: number;
    };
  };
  positions: PortfolioAnalysisPosition[];
  limitations: string[];
}
