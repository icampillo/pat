'use client';
import { HistoryView } from '@/components/history-view';
import type { AppState } from '@/shared/types';

import { useWorkspace } from '@/components/workspace/context';
import { PageHeading } from '@/components/workspace/page-heading';

export function HistoryPage({ state }: { state: AppState }) {
  const { currency } = useWorkspace();
  return (
    <>
      <PageHeading view="history" title="Historique" />
      <HistoryView state={state} currency={currency} />
    </>
  );
}
