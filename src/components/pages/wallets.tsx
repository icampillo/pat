'use client';
import { WalletsPage } from '@/components/wallets';
import type { WalletsState } from '@/shared/types';

import { useWorkspace } from '@/components/workspace/context';

export function WalletsRoutePage({ state }: { state: WalletsState }) {
  const { save } = useWorkspace('wallets');
  return (
    <>
      <WalletsPage state={state} save={save} />
    </>
  );
}
