'use client';
import {
  Download,
  FileUp,
  Plus,
  X,
  Wallet,
  ArrowLeftRight,
  History,
  Settings,
  Coins,
  Layers3,
} from 'lucide-react';
import Link from '@/components/workspace/link';
import { categoryAppearance, categoryStyle } from '@/components/ui/category-appearance';
import { useWorkspace } from './context';

const subtitles: Record<string, string> = {
  portfolio: 'Vos positions et leur répartition.',
  assets: 'Les informations de votre investissement.',
  categories: 'Vos positions, leur valeur et leur évolution.',
  transactions: 'Le journal de vos achats, ventes et mouvements.',
  history: 'Des valeurs conservées, une évolution lisible.',
  settings: 'Les préférences, les sources et les données de votre espace.',
  wallets: 'Vos adresses, tokens et positions DeFi.',
};
const icons = {
  portfolio: Wallet,
  assets: Layers3,
  transactions: ArrowLeftRight,
  history: History,
  settings: Settings,
  wallets: Coins,
};

export function PageHeading({
  view,
  title,
  detail = false,
  actions,
  categoryKey,
  subtitle,
}: {
  view: string;
  title: string;
  detail?: boolean;
  actions?: React.ReactNode;
  categoryKey?: string;
  subtitle?: string;
}) {
  const { flash, setFlash } = useWorkspace();
  const Icon = categoryKey
    ? categoryAppearance(categoryKey).Icon
    : (icons[view as keyof typeof icons] ?? Layers3);
  return (
    <>
      <header className="page-heading">
        <div className="page-title" style={categoryKey ? categoryStyle(categoryKey) : undefined}>
          <span className="page-icon" aria-hidden="true">
            <Icon size={24} />
          </span>
          <div>
            <h1>{title}</h1>
            <p className="subtitle">
              {subtitle ?? subtitles[view] ?? 'Votre patrimoine, en perspective.'}
            </p>
          </div>
        </div>
        {actions ??
          (!detail && !['settings', 'wallets'].includes(view) && (
            <div className="heading-actions" aria-label="Actions de la page">
              {['assets', 'portfolio'].includes(view) && (
                <Link className="btn" href="/categories/stocks#import-bourse">
                  <FileUp size={15} aria-hidden="true" />
                  Importer un CSV Bourse
                </Link>
              )}
              {view !== 'history' && (
                <a
                  className="btn"
                  href={`/api/v1/exports/${view === 'transactions' ? 'transactions' : 'assets'}.csv`}
                >
                  <Download size={16} aria-hidden="true" />
                  Exporter
                </a>
              )}
              <Link
                className="btn primary"
                href={view === 'transactions' ? '/transactions/new' : '/assets/new'}
              >
                <Plus size={17} aria-hidden="true" />
                {view === 'transactions' ? 'Nouvelle transaction' : 'Ajouter un actif'}
              </Link>
            </div>
          ))}
      </header>
      {flash && (
        <div className="notice" role="status">
          <span>{flash}</span>
          <button className="icon-btn" aria-label="Fermer le message" onClick={() => setFlash('')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
