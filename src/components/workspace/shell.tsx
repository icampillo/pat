'use client';
import { WalletAutoRefresh } from '@/components/wallets';
import type { AppState } from '@/shared/types';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Coins,
  History,
  Layers3,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Shapes,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { categorySlug } from '@/domain/categories';
import { usePathname } from 'next/navigation';
import { useWorkspace } from './context';
const nav = [
  { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/portfolio', label: 'Mon portefeuille', icon: Wallet },
  { href: '/assets', label: 'Mes actifs', icon: Shapes },
  { href: '/wallets', label: 'Wallets & DeFi', icon: Coins },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/history', label: 'Historique', icon: History },
];
const titles: Record<string, string> = {
  dashboard: 'Vue d’ensemble',
  portfolio: 'Mon portefeuille',
  assets: 'Mes actifs',
  transactions: 'Transactions',
  history: 'Historique',
  settings: 'Paramètres',
  wallets: 'Wallets & DeFi',
};

export function WorkspaceShell({
  state,
  userName,
  children,
}: {
  state: AppState;
  userName: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [view, slug] = pathname.split('/').filter(Boolean);
  const [mobile, setMobile] = useState(false);
  const { currency, setCurrency } = useWorkspace();
  const pageTitle =
    view === 'categories'
      ? state.categories.find((c) => categorySlug(c.key) === slug)?.label
      : titles[view];
  const sidebar = (
    <>
      <Link href="/dashboard" className="brand">
        <span className="brand-icon">
          <Layers3 size={22} />
        </span>
        patrimoine<span className="brand-dot">.</span>
      </Link>
      <div className="portfolio-switch">
        <span className="portfolio-icon">
          <Wallet size={18} />
        </span>
        <div>
          <strong>{state.portfolio.name}</strong>
          <span>{state.portfolio.isDemo ? 'Démonstration' : 'Espace privé'}</span>
        </div>
        <ChevronDown size={14} />
      </div>
      <p className="nav-label">VOTRE ESPACE</p>
      <nav aria-label="Navigation principale">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => {
              setMobile(false);
            }}
            className={`nav-item ${view === n.href.slice(1) ? 'active' : ''}`}
          >
            <n.icon size={19} />
            {n.label}
            {n.href === '/assets' && (
              <span className="count">{state.rows.filter((a) => !a.deletedAt).length}</span>
            )}
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <Link
          href="/settings"
          onClick={() => setMobile(false)}
          className={`nav-item ${view === 'settings' ? 'active' : ''}`}
        >
          <Settings size={19} />
          Paramètres
        </Link>
        <div className="privacy-card">
          <CircleHelp size={20} className="muted" />
          <strong>Votre patrimoine, votre espace.</strong>
          <p>Vos actifs et vos wallets, un historique conservé.</p>
        </div>
        <button
          className="user-button"
          onClick={async () => {
            await fetch('/api/auth/sign-out', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            });
            router.replace('/login');
            router.refresh();
          }}
        >
          <span className="user-avatar">{userName.slice(0, 2).toUpperCase()}</span>
          <span>
            <strong>{userName}</strong>
            <small>Se déconnecter</small>
          </span>
          <LogOut size={17} />
        </button>
      </div>
    </>
  );
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <aside className="sidebar">{sidebar}</aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumb">
            <Dialog.Root open={mobile} onOpenChange={setMobile}>
              <Dialog.Trigger asChild>
                <button className="icon-btn mobile-only" aria-label="Ouvrir le menu">
                  <Menu size={21} />
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="overlay" />
                <Dialog.Content className="mobile-sidebar">
                  <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                  <Dialog.Description className="sr-only">
                    Accès aux pages du portefeuille
                  </Dialog.Description>
                  <Dialog.Close className="menu-close" aria-label="Fermer le menu">
                    <X size={20} />
                  </Dialog.Close>
                  {sidebar}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <span>Espace personnel</span>
            <ChevronRight size={14} />
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-right">
            {state.portfolio.isDemo && (
              <span className="demo-badge">
                {state.onchain.wallets.length || state.totals.incompleteCostBasis
                  ? 'DÉMO + DONNÉES PERSONNELLES'
                  : 'DONNÉES FICTIVES'}
              </span>
            )}
            <label className="currency-select">
              <span className="sr-only">Devise d’affichage</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as 'EUR' | 'USD')}
              >
                <option value="EUR">€ EUR</option>
                <option value="USD">$ USD</option>
              </select>
            </label>
            <span className="header-avatar">{userName.slice(0, 1).toUpperCase()}</span>
          </div>
        </header>
        <main id="main" className="main">
          {children}
          <WalletAutoRefresh state={state} />
          <footer className="footer">
            <span>Patrimoine · Votre espace personnel</span>
            <span>
              {state.portfolio.isDemo
                ? state.onchain.wallets.length || state.totals.incompleteCostBasis
                  ? 'Démonstration encore présente · wallets et inventaires importés personnels'
                  : 'Prix et historiques de démonstration fictifs'
                : state.onchain.wallets.length
                  ? 'Sources : saisies manuelles et DeBank'
                  : 'Prix saisis manuellement'}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
