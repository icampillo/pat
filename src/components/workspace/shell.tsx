'use client';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeftRight,
  ChevronRight,
  Coins,
  LayoutDashboard,
  LogOut,
  Menu,
  Ellipsis,
  House,
  List,
  ChartPie,
  Settings,
  Wallet,
  X,
} from 'lucide-react';
import Link from '@/components/workspace/link';
import { useState } from 'react';

import shellStyles from './shell.module.css';
import { categorySlug } from '@/domain/categories';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useWorkspace } from './context';
const nav = [
  { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/portfolio', label: 'Portefeuille', icon: Wallet },
  { href: '/activity', label: 'Activité', icon: ArrowLeftRight },
  { href: '/wallets', label: 'Wallets DeFi', icon: Coins },
];
const titles: Record<string, string> = {
  dashboard: 'Vue d’ensemble',
  portfolio: 'Portefeuille',
  assets: 'Mes actifs',
  transactions: 'Transactions',
  history: 'Historique',
  activity: 'Activité',
  settings: 'Paramètres',
  wallets: 'Wallets DeFi',
};

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [view, slug] = pathname.split('/').filter(Boolean);
  const dashboard = view === 'dashboard';
  const activeView =
    view === 'assets' || view === 'categories'
      ? 'portfolio'
      : view === 'transactions' || view === 'history'
        ? 'activity'
        : view;
  const location = pathname + '?' + useSearchParams().toString();
  const [mobileLocation, setMobileLocation] = useState<string | null>(null);
  const mobile = mobileLocation === location;
  // Close on commit, not on click: a slow destination keeps its native Link status mounted.
  if (mobileLocation !== null && !mobile) setMobileLocation(null);
  const setMobile = (open: boolean) => setMobileLocation(open ? location : null);
  const { state, userName, currency, setCurrency } = useWorkspace();
  const pageTitle =
    view === 'categories'
      ? state.categories.find((c) => categorySlug(c.key) === slug)?.label
      : titles[view];
  const sidebar = (
    <>
      <Link href="/dashboard" className="brand">
        <span className="brand-icon">P</span>
        Patrimoine
      </Link>
      <nav aria-label="Navigation principale">
        {nav.map((n) => (
          <div key={n.href}>
            <Link
              href={n.href}
              aria-label={n.label}
              onClick={() => {
                if (pathname === n.href) setMobile(false);
              }}
              aria-current={activeView === n.href.slice(1) ? 'page' : undefined}
              className={`nav-item ${activeView === n.href.slice(1) ? 'active' : ''}`}
            >
              <n.icon size={19} />
              {n.href === '/dashboard' ? (
                <span aria-label="Tableau de bord">Dashboard</span>
              ) : (
                n.label
              )}
            </Link>
            {n.href === '/activity' && (
              <div className={shellStyles.subnav}>
                <Link
                  href="/activity?view=transactions"
                  onClick={() => {
                    if (location === '/activity?view=transactions') setMobile(false);
                  }}
                >
                  Transactions
                </Link>
                <Link
                  href="/activity?view=history"
                  onClick={() => {
                    if (location === '/activity?view=history') setMobile(false);
                  }}
                >
                  Historique
                </Link>
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <Link
          href="/settings"
          onClick={() => {
            if (pathname === '/settings') setMobile(false);
          }}
          aria-current={view === 'settings' ? 'page' : undefined}
          className={`nav-item ${view === 'settings' ? 'active' : ''}`}
        >
          <Settings size={19} />
          Paramètres
        </Link>
        <button
          className="user-button"
          onClick={async () => {
            const response = await fetch('/api/auth/sign-out', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            });
            if (response.ok) router.replace('/login');
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
    <div className={`app ${shellStyles.shell} ${dashboard ? shellStyles.dashboard : ''}`}>
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
                <Dialog.Content className={`mobile-sidebar ${shellStyles.drawer}`}>
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
            {dashboard ? (
              <>
                <Link href="/dashboard" className={shellStyles.mobileBrand}>
                  <span>P</span>Patrimoine
                </Link>
                <span className={shellStyles.status}>
                  <i />
                  {state.portfolio.isDemo
                    ? state.onchain.wallets.length || state.totals.incompleteCostBasis
                      ? 'Démo + données personnelles'
                      : 'Données de démonstration'
                    : state.portfolio.name}
                </span>
              </>
            ) : (
              <>
                <span>Espace personnel</span>
                <ChevronRight size={14} />
                <strong>{pageTitle}</strong>
              </>
            )}
          </div>
          <div className="topbar-right">
            {state.portfolio.isDemo && !dashboard && (
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
          <footer className="footer">
            <span>Patrimoine · Votre espace personnel</span>
            <span>
              {state.portfolio.isDemo
                ? state.onchain.wallets.length || state.totals.incompleteCostBasis
                  ? 'Démonstration encore présente · wallets et inventaires importés personnels'
                  : 'Prix et historiques de démonstration fictifs'
                : state.onchain.wallets.length
                  ? 'Sources : saisies manuelles et wallets'
                  : 'Prix saisis manuellement'}
            </span>
          </footer>
        </main>
      </div>
      <nav className={shellStyles.bottomNav} aria-label="Navigation mobile">
        <Link href="/dashboard" aria-current={activeView === 'dashboard' ? 'page' : undefined}>
          <House size={21} />
          Vue
        </Link>
        <Link href="/portfolio" aria-current={activeView === 'portfolio' ? 'page' : undefined}>
          <ChartPie size={21} />
          Portefeuille
        </Link>
        <Link href="/activity" aria-current={activeView === 'activity' ? 'page' : undefined}>
          <List size={21} />
          Activité
        </Link>
        <button
          type="button"
          aria-label="Plus : ouvrir la navigation"
          onClick={() => setMobile(true)}
        >
          <Ellipsis size={21} />
          Plus
        </button>
      </nav>
    </div>
  );
}
