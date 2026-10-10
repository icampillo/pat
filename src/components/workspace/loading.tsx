'use client';
import { Suspense, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import dashboard from '@/components/dashboard/dashboard.module.css';
import shell from './shell.module.css';

export function Skeleton({
  width = '100%',
  height = '1lh',
  className = '',
}: {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  className?: string;
}) {
  return <span aria-hidden="true" className={`skeleton ${className}`} style={{ width, height }} />;
}

function Heading() {
  return (
    <div className="page-heading">
      <div className="page-title">
        <Skeleton className="page-icon" width={46} height={46} />
        <div>
          <Skeleton width="12em" height={30} />
          <p className="subtitle">
            <Skeleton width="18em" />
          </p>
        </div>
      </div>
      <div className="heading-actions">
        <Skeleton width={160} height={44} />
      </div>
    </div>
  );
}

function Metrics({ category = false }: { category?: boolean }) {
  return (
    <div className={`metrics ${category ? 'category-metrics' : ''}`}>
      {[0, 1, 2, 3].map((item) => (
        <div className="metric" key={item}>
          <div className="metric-top">
            <Skeleton width="70%" />
          </div>
          <strong>
            <Skeleton width="80%" />
          </strong>
          <p>
            <Skeleton width="65%" />
          </p>
        </div>
      ))}
    </div>
  );
}

function Rows({ columns = 5 }: { columns?: number }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, i) => (
              <th key={i}>
                <Skeleton width="70%" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4].map((row) => (
            <tr key={row}>
              {Array.from({ length: columns }, (_, i) => (
                <td key={i}>
                  <Skeleton width={i ? '65%' : '85%'} height={20} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chart() {
  return (
    <div className="chart skeleton-plot">
      <Skeleton height="100%" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className={dashboard.root}>
      <div className={dashboard.overview}>
        <section className={`${dashboard.card} ${dashboard.wealth}`}>
          <div className={dashboard.wealthHead}>
            <div className={dashboard.wealthNumbers}>
              <h2>
                <Skeleton width="70%" />
              </h2>
              <div className={dashboard.amountRow}>
                <strong className={dashboard.total}>
                  <Skeleton width="6em" />
                </strong>
              </div>
            </div>
            <Skeleton className={dashboard.export} width={160} height={44} />
          </div>
          <div className={dashboard.mainPeriods}>
            <Skeleton width={270} height={44} />
          </div>
          <div className={`${dashboard.chart} skeleton-plot`}>
            <Skeleton height="100%" />
          </div>
          <div className={dashboard.freshness}>
            <Skeleton width="55%" height={28} />
          </div>
          <div className={dashboard.sources}>
            <Skeleton width="10em" height={29} />
          </div>
        </section>
        <section className={`${dashboard.card} ${dashboard.allocation}`}>
          <h2>
            <Skeleton width="65%" />
          </h2>
          <p className={dashboard.muted}>
            <Skeleton width="80%" />
          </p>
          <div className={`${dashboard.treemap} skeleton-treemap`}>
            <Skeleton height="100%" />
            <Skeleton height="100%" />
            <Skeleton height="100%" />
          </div>
        </section>
      </div>
      <section>
        <div className={dashboard.sectionHead}>
          <h2>
            <Skeleton width="8em" />
          </h2>
          <Skeleton width={105} height={44} />
        </div>
        <div className={dashboard.categories}>
          {[0, 1, 2, 3].map((item) => (
            <div className={dashboard.categoryCard} key={item}>
              <div className={dashboard.categoryHead}>
                <span className={dashboard.categoryIcon}>
                  <Skeleton height="100%" />
                </span>
                <div className={dashboard.categoryContent}>
                  <div className={dashboard.categoryLink}>
                    <Skeleton width="65%" height={22} />
                  </div>
                  <div className={dashboard.amountRow}>
                    <strong>
                      <Skeleton width="6em" />
                    </strong>
                  </div>
                  <p className={dashboard.weight}>
                    <Skeleton width="60%" />
                  </p>
                </div>
              </div>
              <div className={dashboard.miniChart}>
                <Skeleton height="100%" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PageSkeleton({ pathname, history }: { pathname: string; history: boolean }) {
  if (pathname === '/' || pathname === '/dashboard') return <DashboardSkeleton />;
  const category = pathname.startsWith('/categories/');
  const portfolio = pathname === '/portfolio' || pathname === '/assets';
  const activity =
    pathname === '/activity' || pathname === '/history' || pathname === '/transactions';
  if (category || portfolio || activity)
    return (
      <>
        {category && (
          <div className="back">
            <Skeleton width={140} height={18} />
          </div>
        )}
        {pathname === '/activity' && (
          <div className="activity-tabs">
            <Skeleton width={300} height={44} />
          </div>
        )}
        <Heading />
        {(category || portfolio) && <Metrics category={category} />}
        {category && (
          <div className="charts-grid">
            <section className="panel evolution">
              <div className="section-title">
                <Skeleton width="55%" height={44} />
              </div>
              <Chart />
              <p className="chart-foot">
                <Skeleton width="40%" />
              </p>
            </section>
            <section className="panel allocation">
              <div className="section-title">
                <Skeleton width="70%" height={44} />
              </div>
              <div className="donut-wrap">
                <Skeleton className="skeleton-donut" width={190} height={190} />
              </div>
            </section>
          </div>
        )}
        <section className="panel">
          <div className="table-toolbar">
            <Skeleton width={280} height={44} />
          </div>
          {history && <Chart />}
          <Rows columns={history ? 4 : 5} />
        </section>
      </>
    );
  if (pathname === '/wallets')
    return (
      <>
        <Heading />
        <div className="wallet-overview">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i}>
              <Skeleton width="70%" />
              <Skeleton height={34} />
            </div>
          ))}
        </div>
        <div className="wallet-filters">
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
        <section className="panel">
          <Rows />
        </section>
      </>
    );
  if (pathname.startsWith('/assets/') && pathname !== '/assets/new')
    return (
      <>
        <div className="back">
          <Skeleton width={140} height={18} />
        </div>
        <Heading />
        <div className="detail-top">
          <Skeleton width={200} height={48} />
          <Skeleton width={180} height={44} />
        </div>
        <Metrics />
        <div className="detail-grid">
          <section className="panel detail-panel">
            <h2>
              <Skeleton width="60%" />
            </h2>
            <Skeleton className="skeleton-field" height={44} />
            <div className="form-actions">
              <Skeleton width={160} height={44} />
            </div>
          </section>
          <section className="panel">
            <div className="section-title">
              <Skeleton width="60%" height={26} />
            </div>
            <Rows columns={2} />
          </section>
        </div>
        <section className="panel">
          <Rows />
        </section>
      </>
    );
  const settings = pathname === '/settings';
  return (
    <>
      <Heading />
      <div className={settings ? 'settings-grid' : 'form-wrap'}>
        {Array.from({ length: settings ? 2 : 1 }, (_, i) => (
          <section className="panel detail-panel" key={i}>
            <h2>
              <Skeleton width="60%" />
            </h2>
            <div className={settings ? undefined : 'form-grid'}>
              {Array.from({ length: settings ? 3 : 6 }, (_, field) => (
                <div className="skeleton-form-field" key={field}>
                  <Skeleton width="35%" />
                  <Skeleton className="skeleton-field" height={44} />
                </div>
              ))}
            </div>
            <div className="form-actions">
              <Skeleton width={160} height={44} />
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function ActivitySkeleton() {
  const params = useSearchParams();
  return <PageSkeleton pathname="/activity" history={params.get('view') === 'history'} />;
}

export function WorkspaceLoading({
  fullPage = false,
  pathname = '/dashboard',
  history,
}: {
  fullPage?: boolean;
  pathname?: string;
  history?: boolean;
}) {
  const content = (
    <div
      className="workspace-loading"
      role="status"
      aria-label="Chargement de votre patrimoine"
      aria-busy="true"
    >
      <span className="sr-only">Chargement de votre patrimoine…</span>
      <div aria-hidden="true" className="loading-content">
        {pathname === '/activity' && history === undefined ? (
          <Suspense fallback={<PageSkeleton pathname={pathname} history={false} />}>
            <ActivitySkeleton />
          </Suspense>
        ) : (
          <PageSkeleton pathname={pathname} history={history ?? pathname === '/history'} />
        )}
      </div>
    </div>
  );
  if (!fullPage) return content;
  return (
    <div className={`app ${shell.shell}`}>
      <aside className="sidebar" aria-hidden="true">
        <div className="brand">
          <span className="brand-icon">P</span>Patrimoine
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div className="nav-item" key={i}>
            <Skeleton width="80%" height={20} />
          </div>
        ))}
      </aside>
      <div className="app-body">
        <div className="topbar" aria-hidden="true">
          <Skeleton width={160} height={18} />
        </div>
        <main className="main">{content}</main>
      </div>
      <div className={shell.bottomNav} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div className="skeleton-mobile-nav" key={i}>
            <Skeleton width={32} height={32} />
          </div>
        ))}
      </div>
    </div>
  );
}
