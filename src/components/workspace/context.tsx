'use client';
import type { SaveAction } from '@/components/forms';
import type { AppState } from '@/shared/types';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useRef, useState } from 'react';
type WorkspaceContextValue = {
  currency: 'EUR' | 'USD';
  setCurrency: (currency: 'EUR' | 'USD') => void;
  save: SaveAction;
  run: (action: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  flash: string;
  setFlash: (message: string) => void;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('WorkspaceProvider requis.');
  return context;
}
export function WorkspaceProvider({
  state,
  children,
}: {
  state: AppState;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [currency, setCurrency] = useState<'EUR' | 'USD'>(state.portfolio.displayCurrency);
  const [flash, setFlash] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef(new Map<string, string>());
  const save: SaveAction = async (route, method, data, version) => {
    const signature = JSON.stringify([route, method, data, version]);
    let key = pending.current.get(signature);
    if (!key) {
      key = crypto.randomUUID();
      pending.current.set(signature, key);
    }
    const res = await fetch(`/api/v1/${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        ...(version ? { 'If-Match': String(version) } : {}),
      },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error?.message || 'L’enregistrement a échoué.');
    pending.current.delete(signature);
    setFlash(
      route.startsWith('securities/') || route.endsWith('/preview')
        ? ''
        : 'Enregistrement effectué.',
    );
    router.refresh();
    return result.data;
  };
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFlash('');
    try {
      await action();
    } catch (err) {
      setFlash((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceContext.Provider value={{ currency, setCurrency, save, run, busy, flash, setFlash }}>
      {children}
    </WorkspaceContext.Provider>
  );
}
