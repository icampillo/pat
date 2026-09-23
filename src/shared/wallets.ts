export type WalletToken = {
  id: string;
  chain: string;
  symbol: string;
  name: string;
  amount: string | null;
  valueText?: string;
  priceUsd: string | null;
  valueUsd: string | null;
};
export type DefiPosition = {
  approximate?: boolean;
  valueText?: string;
  id: string;
  protocol: string;
  chain: string;
  kind: string;
  description: string | null;
  assetsUsd: string;
  debtUsd: string;
  netUsd: string;
  observedAt: string | null;
  unlockAt: string | null;
  supplies: WalletToken[];
  rewards: WalletToken[];
  borrows: WalletToken[];
};
export type WalletData = {
  source?: 'DEBANK_PUBLIC' | 'DEBANK_API';
  rounded?: boolean;
  updatedLabel?: string;
  warnings?: string[];
  totalUsd: string;
  tokens: WalletToken[];
  positions: DefiPosition[];
  chains: { id: string; name: string; valueUsd: string }[];
  liquidUsd: string;
  defiUsd: string;
  debtUsd: string;
  rewardsUsd: string;
  reconciliationUsd: string;
};
export type WalletView = {
  id: string;
  address: string;
  label: string;
  referenceUsd: string | null;
  referenceAt: string | null;
  enabled: boolean;
  included: boolean;
  status: string;
  errorCode: string | null;
  lastSuccessAt: string | null;
  nextSyncAt: string;
  stale: boolean;
  data: WalletData | null;
};
export type OnchainState = {
  wallets: WalletView[];
  config: {
    configured: boolean;
    enabled: boolean;
    intervalMinutes: number;
    mode: 'PUBLIC' | 'API';
    hasKey: boolean;
  };
  includedCount: number;
  missing: number;
  staleCount: number;
  valueUsd: string | null;
  valueEur: string | null;
};
export const walletErrors: Record<string, string> = {
  BROWSER: 'Navigateur de lecture indisponible. Lancez pnpm wallet:install dans le projet.',
  PUBLIC_BLOCKED:
    'La page publique DeBank ne répond pas ou refuse la lecture. La dernière valeur est conservée ; nouvelle tentative automatique.',
  AUTH: 'Clé DeBank refusée. Remplacez-la dans les paramètres.',
  CREDITS: 'Crédits DeBank insuffisants ou accès API refusé. Vérifiez DeBank Cloud.',
  RATE_LIMIT: 'Limite DeBank atteinte. Une nouvelle tentative est programmée.',
  NETWORK: 'DeBank est temporairement inaccessible. Nouvelle tentative automatique.',
  FORMAT: 'La réponse DeBank est incomplète ou inattendue. La dernière valeur est conservée.',
  KEY: 'La clé ne peut plus être déchiffrée. Enregistrez-la de nouveau.',
};
export const positionLabels: Record<string, string> = {
  Staked: 'Staking',
  Locked: 'Verrouillé',
  Farming: 'Farming',
  Lending: 'Prêt / emprunt',
  'Liquidity Pool': 'Pool de liquidité',
  Yield: 'Rendement',
  Deposit: 'Dépôt',
  Vesting: 'Vesting',
  Rewards: 'Récompenses',
  Perpetuals: 'Perpétuels',
};
