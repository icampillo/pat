'use client';
import { WalletsPage } from '@/components/wallets';
import type { AppState } from '@/shared/types';

import { useWorkspace } from '@/components/workspace/context';

export function WalletsRoutePage({ state }: { state: AppState }) {
  const { save } = useWorkspace();
  return (
    <>
      <WalletsPage state={state} save={save} />
    </>
  );
}
