'use client';
import { WalletsRoutePage } from '@/components/pages/wallets';
import { useWorkspace } from '@/components/workspace/context';

export default function Page() {
  const { state } = useWorkspace();
  return <WalletsRoutePage state={state} />;
}
