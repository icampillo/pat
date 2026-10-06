'use client';
import { TransactionEditorPage } from '@/components/pages/transactions';
import { useWorkspace } from '@/components/workspace/context';
import { notFound, useParams } from 'next/navigation';
export default function Page() {
  const { id } = useParams<{ id: string }>();
  const { state } = useWorkspace();
  const transaction = state.transactions.find((item) => item.id === id);
  if (!transaction) notFound();
  return <TransactionEditorPage key={id} state={state} transaction={transaction} />;
}
