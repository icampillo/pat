'use client';
import Link from '@/components/workspace/link';
import { HistoryPage } from '@/components/pages/history';
import { TransactionsPage } from '@/components/pages/transactions';
import { useWorkspace } from '@/components/workspace/context';
import { useSearchParams } from 'next/navigation';
export default function Page() {
  const { state } = useWorkspace();
  const history = useSearchParams().get('view') === 'history';
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
