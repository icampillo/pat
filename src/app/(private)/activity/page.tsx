import Link from 'next/link';
import { HistoryPage } from '@/components/pages/history';
import { TransactionsPage } from '@/components/pages/transactions';
import { getPrivateData } from '../_data';
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { state } = await getPrivateData();
  const history = (await searchParams).view === 'history';
  return (
    <>
      <nav className="activity-tabs" aria-label="Vues de l’activité">
        <Link
          className={`btn ${!history ? 'primary' : ''}`}
          aria-current={!history ? 'page' : undefined}
          href="/activity"
        >
          Transactions
        </Link>
        <Link
          className={`btn ${history ? 'primary' : ''}`}
          aria-current={history ? 'page' : undefined}
          href="/activity?view=history"
        >
          Historique du patrimoine
        </Link>
      </nav>
      {history ? <HistoryPage state={state} /> : <TransactionsPage state={state} />}
    </>
  );
}
