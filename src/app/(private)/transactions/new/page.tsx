'use client';
import { TransactionEditorPage } from '@/components/pages/transactions';
import { useWorkspace } from '@/components/workspace/context';

export default function Page() {
  const { state } = useWorkspace();
  return <TransactionEditorPage state={state} />;
}
