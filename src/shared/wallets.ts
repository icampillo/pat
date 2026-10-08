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
  source?: 'DEBANK_PUBLIC' | 'DEBANK_API' | 'ZERION';
  quality?: 'complete' | 'partial';
  excludedPositionIds?: string[];
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
    mode: 'API';
    hasKey: boolean;
  };
  includedCount: number;
  missing: number;
  staleCount: number;
  valueUsd: string | null;
  valueEur: string | null;
};
export const walletErrors: Record<string, string> = {
  AUTH: 'Clé Zerion refusée. Vérifiez la configuration serveur.',
  ACCESS: 'Accès Zerion non autorisé pour cette clé. Aucun abonnement n’est activé.',
  KEY: 'Zerion n’est pas configuré sur le serveur.',
  BAD_REQUEST: 'Adresse ou paramètres non acceptés par Zerion.',
  QUOTA: 'Budget gratuit Zerion atteint. Dernière valeur conservée ; reprise au prochain passage.',
  RATE_LIMIT: 'Limite Zerion atteinte. Dernière valeur conservée ; nouvelle tentative programmée.',
  NETWORK: 'Zerion est temporairement inaccessible. Dernière valeur conservée.',
  SERVER: 'Erreur du service Zerion. Dernière valeur conservée.',
  TIMEOUT: 'Délai de réponse Zerion dépassé. Dernière valeur conservée.',
  FORMAT: 'Réponse Zerion invalide ou incomplète. Dernière valeur conservée.',
  INCOMPLETE: 'Données Zerion incohérentes ou incomplètes. Dernière valeur conservée.',
  PAGINATION: 'Détails Zerion incomplets. Dernière valeur conservée.',
  BROWSER: 'Ancienne erreur DeBank. Les données historiques sont conservées.',
  PUBLIC_BLOCKED: 'Ancienne erreur DeBank. Les données historiques sont conservées.',
  CREDITS: 'Ancienne erreur DeBank. Les données historiques sont conservées.',
};
export const walletSource = (data: WalletData | null) =>
  data?.source === 'ZERION' ? 'Zerion' : data ? 'DeBank (historique)' : 'Zerion';
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
