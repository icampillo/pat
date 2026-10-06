'use client';
import { errorMessage } from '@/shared/errors';
import type { SaveAction } from '@/components/forms';
import type { AppState } from '@/shared/types';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createWorkspaceStore } from './data-store';
import { WorkspaceLoading } from './loading';

type WorkspaceContextValue = {
  state: AppState;
  userName: string;
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
  state: initialState,
  children,
}: {
  state?: AppState;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [store] = useState(() => createWorkspaceStore(initialState));
  const {
    data: state,
    loading,
    error,
    unauthorized,
  } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [selectedCurrency, setCurrency] = useState<'EUR' | 'USD' | null>(null);
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Map<string, string>());
  const syncing =
    state?.onchain.config.enabled &&
    state.onchain.wallets.some(
      (wallet) => wallet.enabled && ['PENDING', 'SYNCING'].includes(wallet.status),
    );

  useEffect(() => {
    if (unauthorized) router.replace('/login');
  }, [unauthorized, router]);
  useEffect(() => {
    if (document.visibilityState === 'visible') void store.refresh();
  }, [pathname, store]);
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === 'visible') void store.refresh();
    };
    const timer = setInterval(
      () => {
        if (document.visibilityState === 'visible' && !store.getSnapshot().loading)
          void store.refresh(Boolean(syncing));
      },
      syncing ? 5_000 : 60_000,
    );
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [store, syncing]);
  useEffect(() => () => store.cancel(), [store]);

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
    if (!route.endsWith('/preview')) await store.refresh(true);
    return result.data;
  };
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFlash('');
    try {
      await action();
    } catch (err) {
      setFlash(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!state)
    return error ? (
      <main className="error-page">
        <p role="alert">{error}</p>
        <button className="btn primary" onClick={() => void store.refresh(true)}>
          Réessayer
        </button>
      </main>
    ) : (
      <WorkspaceLoading fullPage />
    );

  return (
    <WorkspaceContext.Provider
      value={{
        state,
        userName: state.userName || '',
        currency: selectedCurrency ?? state.portfolio.displayCurrency,
        setCurrency,
        save,
        run,
        busy,
        flash,
        setFlash,
      }}
    >
      {loading && (
        <div className="workspace-refresh" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          Actualisation…
        </div>
      )}
      {error && (
        <div className="workspace-refresh refresh-error" role="alert">
          {error} Les dernières données restent affichées.{' '}
          <button className="text-link" onClick={() => void store.refresh(true)}>
            Réessayer
          </button>
        </div>
      )}
      {children}
    </WorkspaceContext.Provider>
  );
}
