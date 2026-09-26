'use client';
import { TransactionForm } from '@/components/forms';
import { typeLabels } from '@/shared/schemas';
import type { AppState } from '@/shared/types';
import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { TransactionTable } from '@/components/transactions/transaction-table';
import { useWorkspace } from '@/components/workspace/context';
import { PageHeading } from '@/components/workspace/page-heading';

import type { TransactionView } from '@/shared/types';
export function TransactionsPage({ state }: { state: AppState }) {
  const { save, run } = useWorkspace();
  const [search, setSearch] = useState('');
  return (
    <>
      <PageHeading view="transactions" title="Transactions" />
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
            `${t.assetName} ${typeLabels[t.type]}`.toLowerCase().includes(search.toLowerCase()),
          )}
          save={save}
          run={run}
        />
      </section>
    </>
  );
}
export function TransactionEditorPage({
  state,
  transaction,
}: {
  state: AppState;
  transaction?: TransactionView;
}) {
  const { save } = useWorkspace();
  const router = useRouter(),
    searchParams = useSearchParams();
  return (
    <>
      <PageHeading
        view="transactions"
        title={transaction ? 'Modifier la transaction' : 'Nouvelle transaction'}
        detail
      />
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
    </>
  );
}
