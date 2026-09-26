'use client';
import type { AppState } from '@/shared/types';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function WalletAutoRefresh({ state }: { state: AppState }) {
  const router = useRouter();
  const enabled = state.onchain.config.enabled && state.onchain.wallets.some((w) => w.enabled);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [enabled, router]);
  return null;
}
