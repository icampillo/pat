'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Layers3,
  LayoutDashboard,
  Wallet,
  Shapes,
  ArrowLeftRight,
  History,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  ChevronRight,
  ChevronDown,
  Download,
  Camera,
  LogOut,
  Menu,
  X,
  CircleHelp,
  Pencil,
  Trash2,
  Archive,
  Coins,
  TrendingUp,
  Banknote,
  RefreshCw,
} from 'lucide-react';
import { EvolutionChart, AllocationChart } from './charts';
import { AssetCategoryCard } from './asset-category-card';
import { CategoryPage } from './category-page';
import { SecuritiesImportPanel } from './securities-import-panel';
import { buildCategoryDetails } from '@/domain/categories';
import { AssetForm, TransactionForm, type SaveAction } from './forms';
import { AssetImage } from './asset-image';
import { HistoryView } from './history-view';
import { PortfolioBreakdown } from './portfolio-breakdown';
import { ImportPanel } from './import-panel';
import { DeBankSettings, WalletAutoRefresh, WalletsPage, WalletSummary } from './wallets';
import { Confirm } from './ui/confirm';
import { decimal as d } from '@/domain/money';
import { dietz } from '@/domain/ledger';
import { typeLabels } from '@/shared/schemas';
import type { AppState, AssetView } from '@/shared/types';
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
const money = (value: string | number | null, currency = 'EUR') =>
  value === null
    ? '—'
    : new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(Number(value));
const qty = (value: string) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 8 }).format(Number(value));
const date = (value: string) =>
  new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
function AssetAvatar({ asset }: { asset: AssetView }) {
  return (
    <span
      className="asset-avatar"
      style={{ background: `${asset.category.color}15`, color: asset.category.color }}
    >
      {asset.symbol === 'BTC' ? '₿' : asset.symbol === 'ETH' ? 'Ξ' : asset.symbol.slice(0, 2)}
    </span>
  );
}
function Signed({ value, currency = 'EUR' }: { value: string | null; currency?: string }) {
  return (
    <span className={value !== null ? (d(value).gte(0) ? 'positive' : 'negative') : 'muted'}>
      {value !== null && d(value).gte(0) ? '+' : ''}
      {money(value, currency)}
    </span>
  );
}

export function Workspace({
  initialState: state,
  path,
  userName,
}: {
  initialState: AppState;
  path: string[];
  userName: string;
}) {
  const router = useRouter(),
    searchParams = useSearchParams();
  const [currency, setCurrency] = useState<'EUR' | 'USD'>(state.portfolio.displayCurrency);
  const [period, setPeriod] = useState('1y'),
    [category, setCategory] = useState('all'),
    [search, setSearch] = useState('');
  const [mobile, setMobile] = useState(false),
    [flash, setFlash] = useState(''),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false);
  const pending = useRef(new Map<string, string>());
  const view = path[0],
    asset =
      view === 'assets' ? state.rows.find((a) => a.id === path[1] && !a.deletedAt) : undefined;
  const transaction =
    view === 'transactions' ? state.transactions.find((t) => t.id === path[1]) : undefined;
  const val = (a: AssetView) => (currency === 'EUR' ? a.valueEur : a.valueUsd);
  const gain = (a: AssetView) => (currency === 'EUR' ? a.gainEur : a.gainUsd);
  const save: SaveAction = async (route, method, data, version) => {
    const signature = JSON.stringify([route, method, data, version]);
    let key = pending.current.get(signature);
    if (!key) {
      key = crypto.randomUUID();
      pending.current.set(signature, key);
    }
    const res = await fetch(`/api/v1/${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        ...(version ? { 'If-Match': String(version) } : {}),
      },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error?.message || 'L’enregistrement a échoué.');
    pending.current.delete(signature);
    setFlash(route.startsWith('securities/') || route.endsWith('/preview') ? '' : 'Enregistrement effectué.');
    router.refresh();
    return result.data;
  };
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFlash('');
    try {
      await action();
    } catch (err) {
      setFlash((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const shown = state.rows.filter(
    (a) =>
      !a.deletedAt &&
      (category === 'all' || a.categoryId === category) &&
      `${a.name} ${a.symbol}`.toLowerCase().includes(search.toLowerCase()),
  );
  const total = currency === 'EUR' ? state.totals.valueEur : state.totals.valueUsd;
  const categoryDetails = state.categories.map((item) =>
    buildCategoryDetails(state, item, currency),
  );
  const currentCategory =
    view === 'categories'
      ? categoryDetails.find((item) => item.category.slug === path[1])
      : undefined;
  const pageTitle = currentCategory?.category.name ?? titles[view];
  const days = ({ '24h': 1, '7d': 7, '30d': 30, '1y': 365, all: 10000 } as Record<string, number>)[
    period
  ];
  const startTime = Date.parse(state.asOf) - days * 86400000;
  const baseline = [...state.snapshots]
    .reverse()
    .find((s) => Date.parse(s.capturedAt) <= startTime);
  const visibleSnapshots = state.snapshots.filter(
    (s) => Date.parse(s.capturedAt) >= (baseline ? Date.parse(baseline.capturedAt) : startTime),
  );
  const points = visibleSnapshots.map((s) => ({
    date: s.capturedAt,
    value:
      (currency === 'EUR' ? s.totalEur : s.totalUsd) === null
        ? null
        : Number(currency === 'EUR' ? s.totalEur : s.totalUsd),
  }));
  const slices = categoryDetails
    .filter((item) => item.category.totalValue !== null && item.category.totalValue > 0)
    .map(({ category }) => ({
      name: category.name,
      color: category.color,
      value: category.totalValue!,
    }));
  const cashTotal = state.cash.reduce(
    (sum, c) => sum.add((currency === 'EUR' ? c.valueEur : c.valueUsd) || 0),
    d(0),
  );
  if (cashTotal.gt(0))
    slices.push({ name: 'Liquidités', color: '#a0adbd', value: Number(cashTotal) });
  const first = visibleSnapshots[0];
  const adjusted =
    !state.totals.incompleteCostBasis &&
    !state.onchain.includedCount &&
    !state.snapshots.some((s) => s.kind === 'WALLET') &&
    !state.historyRevised &&
    currency === 'EUR' &&
    first?.totalEur &&
    state.totals.valueEur
      ? dietz(first.totalEur, state.totals.valueEur, first.capturedAt, state.asOf, state.flows)
      : null;
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
              setSearch('');
              setEditing(false);
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
        <Link href="/settings" className={`nav-item ${view === 'settings' ? 'active' : ''}`}>
          <Settings size={19} />
          Paramètres
        </Link>
        <div className="privacy-card">
          <ShieldIcon />
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
  const filters = (
    <div className="table-toolbar">
      <div className="search">
        <Search size={17} />
        <input
          aria-label="Rechercher un actif"
          placeholder="Rechercher un actif…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <select
        aria-label="Filtrer par catégorie"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="all">Toutes les catégories</option>
        {state.categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <span className="muted small">{shown.length} actifs</span>
    </div>
  );
  const assetTable = (rows: AssetView[]) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Actif</th>
            <th>Catégorie</th>
            <th className="num">Quantité</th>
            <th className="num">Prix actuel</th>
            <th className="num">Valeur</th>
            <th className="num">Plus-value latente</th>
            <th>
              <span className="sr-only">Détail</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                <Link href={`/assets/${a.id}`} className="asset-cell">
                  <AssetAvatar asset={a} />
                  <span>
                    <strong>{a.name}</strong>
                    {(a.symbol !== a.name || a.status === 'ARCHIVED') && (
                      <small>
                        {a.symbol !== a.name ? a.symbol : ''}
                        {a.status === 'ARCHIVED' ? ' · Archivé' : ''}
                      </small>
                    )}
                  </span>
                </Link>
              </td>
              <td>
                <span
                  className="category-pill"
                  style={{ color: a.category.color, background: `${a.category.color}10` }}
                >
                  {a.category.label}
                </span>
              </td>
              <td className="num">{qty(a.quantity)}</td>
              <td className="num">
                {money(a.price, a.currency)}
                {a.stale && a.price && <small className="muted">Prix ancien</small>}
              </td>
              <td className="num strong">{money(val(a), currency)}</td>
              <td className="num">
                <Signed value={gain(a)} currency={currency} />
              </td>
              <td>
                <Link
                  className="icon-link"
                  href={`/assets/${a.id}`}
                  aria-label={`Ouvrir ${a.name}`}
                >
                  <ChevronRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty
          title="Aucun actif pour le moment"
          text="Ajoutez un actif et sa quantité pour commencer."
          href="/assets/new"
          label="Ajouter un actif"
        />
      )}
    </div>
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
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {view === 'dashboard' ? 'VOTRE PATRIMOINE EN UN REGARD' : 'VOTRE ESPACE PERSONNEL'}
              </p>
              <h1>
                {path[1] === 'new'
                  ? view === 'assets'
                    ? 'Ajouter un actif'
                    : 'Nouvelle transaction'
                  : asset
                    ? asset.name
                    : transaction
                      ? 'Modifier la transaction'
                      : pageTitle}
              </h1>
              <p className="subtitle">
                {view === 'dashboard'
                  ? 'Suivez vos investissements et vos collections, simplement.'
                  : view === 'assets'
                    ? 'Chaque investissement a sa place.'
                    : view === 'transactions'
                      ? 'Le journal de vos achats, ventes et mouvements.'
                      : view === 'history'
                        ? 'Des valeurs conservées, une évolution lisible.'
                        : view === 'settings'
                          ? 'Les préférences et les données de votre espace.'
                          : 'Vos positions et leur répartition.'}
              </p>
            </div>
            {!path[1] && !['settings', 'wallets'].includes(view) && (
              <div className="heading-actions">
                {['dashboard', 'assets'].includes(view) && (
                  <Link className="btn" href="/categories/stocks#import-bourse">
                    Importer un CSV Bourse
                  </Link>
                )}
                {view === 'dashboard' || view === 'history' ? (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => run(() => save('snapshots', 'POST', {}))}
                  >
                    <Camera size={16} />
                    Enregistrer un snapshot
                  </button>
                ) : (
                  <a
                    className="btn"
                    href={`/api/v1/exports/${view === 'transactions' ? 'transactions' : 'assets'}.csv`}
                  >
                    <Download size={16} />
                    Exporter
                  </a>
                )}
                <Link
                  className="btn primary"
                  href={view === 'transactions' ? '/transactions/new' : '/assets/new'}
                >
                  <Plus size={17} />
                  {view === 'transactions' ? 'Nouvelle transaction' : 'Ajouter un actif'}
                </Link>
              </div>
            )}
          </div>
          {flash && (
            <div className="notice" role="status">
              <span>{flash}</span>
              <button
                className="icon-btn"
                aria-label="Fermer le message"
                onClick={() => setFlash('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === 'dashboard' && (
            <>
              <div className="charts-grid">
                <section className="panel evolution">
                  <div className="section-title">
                    <div>
                      <h2>Évolution du patrimoine</h2>
                      <p>
                        {first
                          ? `Depuis le ${date(first.capturedAt)}`
                          : 'Vos prochaines captures apparaîtront ici'}
                      </p>
                    </div>
                    <div className="periods">
                      {[
                        ['24h', '24 h'],
                        ['7d', '7 j'],
                        ['30d', '30 j'],
                        ['1y', '1 an'],
                        ['all', 'Tout'],
                      ].map(([v, l]) => (
                        <button
                          aria-pressed={period === v}
                          key={v}
                          className={period === v ? 'selected' : ''}
                          onClick={() => setPeriod(v)}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="chart-summary">
                    <strong>{money(total, currency)}</strong>
                    {adjusted !== null && (
                      <span
                        className={
                          d(adjusted).gte(0) ? 'trend-pill positive' : 'trend-pill negative'
                        }
                      >
                        {d(adjusted).gte(0) ? (
                          <ArrowUpRight size={15} />
                        ) : (
                          <ArrowDownRight size={15} />
                        )}{' '}
                        {Number(adjusted).toFixed(2)} % <span>après flux · estimé</span>
                      </span>
                    )}
                  </div>
                  <EvolutionChart points={points} currency={currency} />
                  <div className="chart-foot">
                    <span className="dot purple" /> Valeur totale du portefeuille
                    <Link href="/history">
                      Voir l’historique <ArrowUpRight size={14} />
                    </Link>
                  </div>
                </section>
                <section className="panel allocation">
                  <div className="section-title">
                    <div>
                      <h2>Répartition</h2>
                      <p>
                        {total === null
                          ? 'Valorisation incomplète · valeurs connues'
                          : 'Par catégorie d’actifs'}
                      </p>
                    </div>
                    <Coins size={19} className="muted" />
                  </div>
                  {slices.length ? (
                    <>
                      <AllocationChart slices={slices} />
                      <div className="legend">
                        {slices.map((s) => (
                          <div key={s.name}>
                            <span className="dot" style={{ background: s.color }} />
                            <span>{s.name}</span>
                            <strong>
                              {total && d(total).gt(0)
                                ? `${d(s.value).div(total).mul(100).toFixed(1)} %`
                                : '—'}
                            </strong>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="chart-empty">
                      Votre répartition apparaîtra après un premier achat.
                    </p>
                  )}
                </section>
              </div>
              <section aria-label="Catégories détenues" className="category-grid">
                {categoryDetails
                  .filter((item) => item.category.assetCount > 0)
                  .map((item) => (
                    <AssetCategoryCard
                      key={item.category.id}
                      category={item.category}
                      currency={currency}
                    />
                  ))}
              </section>
              {!categoryDetails.some((item) => item.category.assetCount > 0) && (
                <section className="panel">
                  <Empty
                    title="Aucune catégorie détenue"
                    text="Ajoutez votre premier actif pour suivre vos investissements."
                    href="/assets/new"
                    label="Ajouter un actif"
                  />
                </section>
              )}
            </>
          )}
          {currentCategory && (
            <>
              {currentCategory.category.slug === 'stocks' && <SecuritiesImportPanel save={save} />}
              <CategoryPage
                key={currentCategory.category.id}
                details={currentCategory}
                currency={currency}
                asOf={state.asOf}
              />
            </>
          )}
          {view === 'assets' && path[1] === 'new' && (
            <AssetForm
              state={state}
              save={save}
              done={(id) => {
                router.push(`/assets/${id}`);
                router.refresh();
              }}
            />
          )}
          {view === 'assets' && !path[1] && (
            <section className="panel">
              {filters}
              {assetTable(shown)}
            </section>
          )}
          {view === 'assets' && path[1] && path[1] !== 'new' && !asset && (
            <Empty
              title="Actif introuvable"
              text="Cette fiche n’est pas disponible dans votre portefeuille."
              href="/assets"
              label="Revenir aux actifs"
            />
          )}
          {asset &&
            (editing ? (
              <AssetForm
                state={state}
                asset={asset}
                save={save}
                done={() => {
                  setEditing(false);
                  router.refresh();
                }}
              />
            ) : (
              <>
                <div className="detail-top">
                  <div className="detail-identity">
                    <AssetAvatar asset={asset} />
                    <div>
                      <strong>{asset.symbol}</strong>
                      <p>
                        {asset.category.label} · {asset.platform}
                      </p>
                    </div>
                  </div>
                  <div className="heading-actions">
                    <button className="btn" onClick={() => setEditing(true)}>
                      <Pencil size={15} />
                      Modifier
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          save(
                            `assets/${asset.id}`,
                            'PATCH',
                            {
                              name: asset.name,
                              symbol: asset.symbol,
                              categoryId: asset.categoryId,
                              currency: asset.currency,
                              platform: asset.platform,
                              subcategory: asset.subcategory || '',
                              externalId: asset.externalId || '',
                              notes: asset.notes,
                              metadata: asset.metadata,
                              status: asset.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED',
                            },
                            asset.version,
                          ),
                        )
                      }
                    >
                      <Archive size={15} />
                      {asset.status === 'ARCHIVED' ? 'Réactiver' : 'Archiver'}
                    </button>
                    <Confirm
                      title={`Supprimer définitivement ${asset.name} ?`}
                      description="La fiche, ses opérations, ses prix et son image seront effacés, même si vous détenez encore cet actif. Les captures historiques qui le contiennent seront également supprimées. Cette action est irréversible."
                      onConfirm={() =>
                        run(async () => {
                          await save(
                            `assets/${asset.id}`,
                            'DELETE',
                            { confirmed: true },
                            asset.version,
                          );
                          router.push('/assets');
                        })
                      }
                    >
                      <button className="btn icon-btn" aria-label="Supprimer cet actif">
                        <Trash2 size={17} />
                      </button>
                    </Confirm>
                  </div>
                </div>
                <div className="metrics">
                  <Metric
                    title="Valeur actuelle"
                    value={money(val(asset), currency)}
                    note={
                      asset.priceDate ? `Prix du ${date(asset.priceDate)}` : 'Aucun prix renseigné'
                    }
                    icon={<Wallet size={18} />}
                  />
                  <Metric
                    title="Quantité détenue"
                    value={qty(asset.quantity)}
                    note={asset.symbol}
                    icon={<Shapes size={18} />}
                  />
                  <Metric
                    title="Coût d’acquisition total"
                    value={money(asset.costEur, 'EUR')}
                    note={
                      asset.metadata.costBasis === 'UNKNOWN'
                        ? 'Coût d’acquisition non renseigné'
                        : 'Montant connu pour la quantité détenue'
                    }
                    icon={<Banknote size={18} />}
                  />
                  <Metric
                    title="Plus-value latente"
                    value={money(gain(asset), currency)}
                    note="Sur les unités encore détenues"
                    icon={<TrendingUp size={18} />}
                  />
                </div>
                <div className="detail-grid">
                  {asset.metadata.pricingMode === 'SECURITIES_MARKET' ? (
                    <section className="panel detail-panel">
                      <h2>Cours automatique</h2>
                      <p className="muted">
                        {asset.metadata.ticker} · {asset.metadata.exchange} · Yahoo Finance
                      </p>
                      <p className="small muted">
                        {asset.priceDate
                          ? `Dernier cours du ${date(asset.priceDate)}${asset.stale ? ' · cours ancien' : ''}`
                          : 'En attente de cotation.'}{' '}
                        Actualisation toutes les 15 minutes lorsque le serveur fonctionne.
                      </p>
                      <PriceHistoryList id={asset.id} currency={asset.currency} />
                    </section>
                  ) : asset.category.key === 'METALS' ? (
                    <section className="panel detail-panel">
                      <h2>Valeur de la pièce</h2>
                      <p className="muted">
                        Calculée automatiquement avec le cours de l’or ou de l’argent, le poids et
                        la pureté indiqués sur cette fiche.
                      </p>
                      <p className="small muted">
                        {asset.priceDate
                          ? `Dernier cours du ${date(asset.priceDate)}${asset.stale ? ' · cours ancien' : ''}`
                          : 'En attente de la première cotation.'}
                      </p>
                      <PriceHistoryList id={asset.id} currency={asset.currency} />
                    </section>
                  ) : (
                    <section className="panel detail-panel">
                      <h2>Mettre à jour le prix</h2>
                      <p className="muted">Chaque prix est conservé dans l’historique.</p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          run(() =>
                            save(`assets/${asset.id}/prices`, 'POST', {
                              price: String(fd.get('price')),
                              observedAt: new Date().toISOString(),
                            }),
                          );
                        }}
                      >
                        <label>
                          Prix unitaire ({asset.currency})
                          <input
                            name="price"
                            inputMode="decimal"
                            required
                            defaultValue={asset.price || ''}
                          />
                        </label>
                        <button className="btn primary" disabled={busy}>
                          <RefreshCw size={16} />
                          Enregistrer le prix
                        </button>
                      </form>
                      <PriceHistoryList id={asset.id} currency={asset.currency} />
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await save(`assets/${asset.id}/refresh`, 'POST', {});
                            setFlash(
                              'Fournisseur externe non configuré : dernier prix connu conservé.',
                            );
                          })
                        }
                      >
                        Vérifier la source de prix
                      </button>
                    </section>
                  )}
                  <section className="panel detail-panel">
                    <h2>Informations</h2>
                    <AssetImage id={asset.id} updatedAt={asset.image?.updatedAt} save={save} />
                    <dl className="details-list">
                      <div>
                        <dt>Statut</dt>
                        <dd>
                          {asset.status === 'ARCHIVED'
                            ? 'Archivé'
                            : d(asset.quantity).isZero()
                              ? 'Aucune position'
                              : 'Actif'}
                        </dd>
                      </div>
                      {Object.entries(asset.metadata)
                        .filter(
                          ([key]) =>
                            ![
                              'costBasis',
                              'coinType',
                              'pricingMode',
                              'gramPrice',
                              'premium',
                            ].includes(key),
                        )
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>{metadataLabels[key] || key}</dt>
                            <dd>
                              {key === 'costBasis'
                                ? value === 'UNKNOWN'
                                  ? 'Non renseigné'
                                  : 'Renseigné dans les opérations'
                                : key === 'metalType'
                                  ? value === 'GOLD'
                                    ? 'Or'
                                    : 'Argent'
                                  : key === 'pricingMode' && value === 'GRAM'
                                    ? 'Métal fin au gramme'
                                    : key === 'pricingMode' && value === 'METAL_MARKET'
                                      ? 'Cours du métal actualisé'
                                      : key === 'pricingMode' && value === 'SECURITIES_MARKET'
                                        ? 'Cours boursier automatique'
                                        : String(value)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                    {asset.notes && (
                      <div className="notes">
                        <h3>Notes</h3>
                        <p>{asset.notes}</p>
                      </div>
                    )}
                    <Link className="btn" href={`/transactions/new?asset=${asset.id}`}>
                      <Plus size={16} />
                      Ajouter une transaction
                    </Link>
                  </section>
                </div>
                <section className="panel">
                  <div className="section-title">
                    <h2>Transactions de l’actif</h2>
                  </div>
                  <TransactionTable
                    state={state}
                    rows={state.transactions.filter((t) => t.assetId === asset.id)}
                    save={save}
                    run={run}
                  />
                </section>
              </>
            ))}
          {view === 'transactions' && (path[1] === 'new' || transaction) && (
            <TransactionForm
              transaction={transaction}
              state={state}
              save={save}
              initialAsset={searchParams.get('asset') || undefined}
              done={() => {
                router.push('/transactions');
                router.refresh();
              }}
            />
          )}
          {view === 'transactions' && !path[1] && (
            <section className="panel">
              <div className="table-toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Rechercher une transaction"
                    placeholder="Rechercher un actif ou une opération…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <span className="muted">{state.transactions.length} opérations</span>
              </div>
              <TransactionTable
                state={state}
                rows={state.transactions.filter((t) =>
                  `${t.assetName} ${typeLabels[t.type]}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )}
                save={save}
                run={run}
              />
            </section>
          )}
          {view === 'portfolio' && (
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
              <section className="panel">
                {filters}
                {assetTable(shown)}
              </section>
              <section className="panel">
                <div className="section-title">
                  <h2>Liquidités disponibles</h2>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Plateforme</th>
                        <th>Devise</th>
                        <th className="num">Solde</th>
                        <th className="num">Valeur {currency}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.cash.map((c, i) => (
                        <tr key={i}>
                          <td>{c.platform}</td>
                          <td>{c.currency}</td>
                          <td className="num">{money(c.balance, c.currency)}</td>
                          <td className="num">
                            {money(currency === 'EUR' ? c.valueEur : c.valueUsd, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!state.cash.length && (
                    <p className="empty-inline">
                      Aucune liquidité enregistrée. Les achats financés depuis l’extérieur
                      n’entament pas un solde interne.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
          {view === 'history' && <HistoryView state={state} currency={currency} />}
          <WalletAutoRefresh state={state} />
          {view === 'wallets' && <WalletsPage state={state} save={save} />}
          {['assets', 'portfolio'].includes(view) && !path[1] && (
            <WalletSummary state={state} currency={currency} />
          )}
          {view === 'settings' && (
            <SettingsContent state={state} save={save} run={run} busy={busy} />
          )}
          {view === 'portfolio' && <PortfolioBreakdown state={state} currency={currency} />}
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
function ShieldIcon() {
  return <CircleHelp size={20} className="muted" />;
}
function Metric({
  title,
  value,
  note,
  icon,
  accent = false,
  positive = false,
}: {
  title: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  accent?: boolean;
  positive?: boolean;
}) {
  return (
    <section className={`metric ${accent ? 'accent' : ''}`}>
      <div className="metric-top">
        <span>{title}</span>
        {icon}
      </div>
      <strong className={positive ? 'positive' : ''}>{value}</strong>
      <p>{note}</p>
    </section>
  );
}
function Empty({
  title,
  text,
  href,
  label,
}: {
  title: string;
  text: string;
  href: string;
  label: string;
}) {
  return (
    <div className="empty">
      <Shapes size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      <Link className="btn primary" href={href}>
        {label}
      </Link>
    </div>
  );
}
function TransactionTable({
  state,
  rows,
  save,
  run,
}: {
  state: AppState;
  rows: AppState['transactions'];
  save: SaveAction;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Opération</th>
            <th>Actif</th>
            <th className="num">Quantité</th>
            <th className="num">Montant brut</th>
            <th className="num">Frais</th>
            <th>Plateforme</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{date(t.occurredAt)}</td>
              <td>
                <span
                  className={`transaction-type ${t.type === 'BUY' ? 'buy' : t.type === 'SELL' ? 'sell' : ''}`}
                >
                  {typeLabels[t.type]}
                </span>
              </td>
              <td className="strong">{t.assetName}</td>
              <td className="num">{qty(t.quantity)}</td>
              <td className="num">
                {t.type === 'ADJUSTMENT' &&
                state.rows.find((a) => a.id === t.assetId)?.metadata.costBasis === 'UNKNOWN' ? (
                  <span title="Montant non renseigné dans l’inventaire">—</span>
                ) : (
                  money(t.amount, t.currency)
                )}
              </td>
              <td className="num muted">{money(t.fees, t.currency)}</td>
              <td>{t.platform}</td>
              <td>
                <Link
                  className="icon-btn"
                  href={`/transactions/${t.id}`}
                  aria-label={`Modifier ${typeLabels[t.type]} ${t.assetName}`}
                >
                  <Pencil size={16} />
                </Link>
                <Confirm
                  title="Annuler cette transaction ?"
                  description="Les positions seront recalculées. L’annulation sera refusée si elle rend une autre opération impossible. Une trace sera conservée."
                  onConfirm={() =>
                    run(() =>
                      save(
                        `transactions/${t.id}`,
                        'DELETE',
                        { confirmed: true, reason: 'Annulation confirmée depuis le journal' },
                        t.version,
                      ),
                    )
                  }
                >
                  <button
                    className="icon-btn"
                    aria-label={`Annuler ${typeLabels[t.type]} ${t.assetName}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </Confirm>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty
          title="Le journal est vide"
          text="Enregistrez votre premier achat ou dépôt."
          href="/transactions/new"
          label="Ajouter une transaction"
        />
      )}
    </div>
  );
}
function PriceHistoryList({ id, currency }: { id: string; currency: string }) {
  const [prices, setPrices] = useState<
      { id: string; price: string; observedAt: string; source: string }[] | null
    >(null),
    [error, setError] = useState('');
  return (
    <div className="price-history">
      <button
        className="text-link"
        onClick={async () => {
          try {
            const res = await fetch(`/api/v1/assets/${id}/prices`);
            if (!res.ok) throw new Error();
            const data = await res.json();
            setPrices(data.data);
          } catch {
            setError('Historique indisponible.');
          }
        }}
      >
        Consulter l’historique des prix <History size={15} />
      </button>
      {error && <p role="alert">{error}</p>}
      {prices && (
        <div className="price-list">
          {prices.map((p) => (
            <div key={p.id}>
              <span>{date(p.observedAt)}</span>
              <strong>{money(p.price, currency)}</strong>
              <small className="muted">
                {p.source.startsWith('gold-api:')
                  ? 'Métal spot · Gold API, change BCE'
                  : p.source === 'import-xlsx-cached'
                    ? 'Valeur indicative importée'
                    : p.source}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function SettingsContent({
  state,
  save,
  run,
  busy,
}: {
  state: AppState;
  save: SaveAction;
  run: (action: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="settings-grid">
      <DeBankSettings state={state} save={save} />
      <section className="panel detail-panel">
        <h2>Votre portefeuille</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() =>
              save('settings', 'PATCH', {
                name: fd.get('name'),
                displayCurrency: fd.get('displayCurrency'),
                timezone: fd.get('timezone'),
              }),
            );
          }}
        >
          <label>
            Nom
            <input name="name" defaultValue={state.portfolio.name} required maxLength={120} />
          </label>
          <label>
            Devise d’affichage par défaut
            <select name="displayCurrency" defaultValue={state.portfolio.displayCurrency}>
              <option>EUR</option>
              <option>USD</option>
            </select>
          </label>
          <label>
            Fuseau horaire
            <select name="timezone" defaultValue={state.portfolio.timezone}>
              <option>Europe/Paris</option>
              <option>UTC</option>
            </select>
          </label>
          <button className="btn primary" disabled={busy}>
            Enregistrer les préférences
          </button>
        </form>
      </section>
      <section className="panel detail-panel">
        <h2>Taux de change</h2>
        <p className="muted">
          {state.fxRate
            ? `Dernier taux : 1 EUR = ${state.fxRate.eurUsd} USD · ${date(state.fxRate.observedAt)} · ${state.fxRate.source === 'ecb' ? 'BCE' : 'saisie manuelle'}`
            : 'Aucun taux EUR/USD renseigné.'}
        </p>
        <button
          className="btn"
          disabled={busy}
          onClick={() => run(() => save('market/refresh', 'POST', {}))}
        >
          Actualiser les cours et le taux
        </button>
        <p className="small muted">
          Mise à jour automatique toutes les 15 minutes lorsque le serveur fonctionne. La valeur des
          pièces repose sur leur métal fin ; elle ne comprend pas de prime numismatique non
          renseignée.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() =>
              save('fx-rates', 'POST', {
                eurUsd: fd.get('eurUsd'),
                observedAt: new Date(String(fd.get('observedAt'))).toISOString(),
              }),
            );
          }}
        >
          <label>
            USD pour 1 EUR
            <input name="eurUsd" required inputMode="decimal" placeholder="1.10" />
          </label>
          <label>
            Date du taux
            <input name="observedAt" type="datetime-local" required />
          </label>
          <button className="btn primary" disabled={busy}>
            Enregistrer le taux
          </button>
        </form>
        <p className="small muted">
          Les transactions et snapshots déjà enregistrés conservent leurs taux historiques.
        </p>
      </section>
      <section className="panel detail-panel">
        <h2>Vos données</h2>
        <p className="muted">Téléchargez une copie privée de votre portefeuille.</p>
        <div className="export-list">
          {[
            ['assets.csv', 'Actifs · CSV'],
            ['transactions.csv', 'Transactions · CSV'],
            ['history.csv', 'Historique · CSV'],
            ['portfolio.json', 'Données complètes · JSON'],
          ].map(([file, label]) => (
            <a key={file} href={`/api/v1/exports/${file}`}>
              <span>{label}</span>
              <Download size={17} />
            </a>
          ))}
        </div>
      </section>
      <section className="panel detail-panel">
        <h2>Sources de prix</h2>
        <div className="provider-row">
          <span>Saisie manuelle</span>
          <span className="tag success">Disponible</span>
        </div>
        <div className="provider-row">
          <span>Wallets crypto · DeBank</span>
          <span className="tag">
            {state.onchain.config.configured
              ? state.onchain.config.enabled
                ? 'Automatique'
                : 'En pause'
              : 'Clé à renseigner'}
          </span>
        </div>
        <div className="provider-row">
          <span>Bourse · Yahoo Finance</span>
          <span className="tag success">Automatique après import CSV</span>
        </div>
        <div className="provider-row">
          <span>Métaux précieux · Gold API</span>
          <span className="tag success">Automatique</span>
        </div>
        {['Cryptos saisies manuellement', 'Cartes de collection'].map((label) => (
          <div className="provider-row" key={label}>
            <span>{label}</span>
            <span className="muted small">API non configurée</span>
          </div>
        ))}
        <p className="small muted">
          Les cours Bourse importés et les métaux sont actualisés toutes les 15 minutes. DeBank
          actualise les adresses ajoutées dans Wallets & DeFi.
        </p>
      </section>
      <ImportPanel save={save} />
      <SecuritiesImportPanel save={save} />
    </div>
  );
}
const metadataLabels: Record<string, string> = {
  costBasis: 'Coût d’acquisition',
  network: 'Réseau',
  contractAddress: 'Contrat',
  stakingRate: 'Rendement indicatif',
  metalType: 'Métal',
  weightGrams: 'Poids (g)',
  purity: 'Pureté',
  gramPrice: 'Cours par gramme',
  premium: 'Prime par unité',
  coinType: 'Type de pièce',
  year: 'Année',
  country: 'Pays',
  faceValue: 'Valeur faciale',
  pricingMode: 'Mode de prix',
  ticker: 'Ticker',
  exchange: 'Marché',
  isin: 'ISIN',
  instrumentType: 'Instrument',
  setName: 'Extension',
  language: 'Langue',
  condition: 'État',
  cardNumber: 'Numéro',
  grade: 'Grade',
  gradingCompany: 'Société de grading',
  certificateNumber: 'Certification',
  referenceUrl: 'Référence externe',
};
