'use client';
import { WalletsPage } from '@/components/wallets';
import type { AppState } from '@/shared/types';

import { useWorkspace } from '@/components/workspace/context';
import { PageHeading } from '@/components/workspace/page-heading';

export function WalletsRoutePage({ state }: { state: AppState }) {
  const { save } = useWorkspace();
  return (
    <>
      <PageHeading view="wallets" title="Wallets & DeFi" />
      <WalletsPage state={state} save={save} />
    </>
  );
}
