'use client';
import { errorMessage } from '@/shared/errors';
import type { SaveAction } from '@/components/forms';
import {
  coversScope,
  pageReadScope,
  type AppState,
  type SettingsState,
  type WalletsState,
  type WorkspaceState,
} from '@/shared/types';
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
import { startWalletPolling } from './wallet-polling';
import { readApiResponse } from './api';
import { WorkspaceLoading } from './loading';

type WorkspaceContextValue = {
  state: WorkspaceState;
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
type ContextWith<T> = Omit<WorkspaceContextValue, 'state'> & { state: T };
export function useWorkspace(): ContextWith<AppState>;
export function useWorkspace(scope: 'settings'): ContextWith<SettingsState>;
export function useWorkspace(scope: 'wallets'): ContextWith<WalletsState>;
export function useWorkspace(scope: 'base'): WorkspaceContextValue;
export function useWorkspace(scope: 'full' | 'settings' | 'wallets' | 'base' = 'full') {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('WorkspaceProvider requis.');
  if (scope !== 'base' && !coversScope(context.state, scope))
    throw new Error('Données de page non chargées.');
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
    error,
    walletError,
    unauthorized,
  } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [selectedCurrency, setCurrency] = useState<'EUR' | 'USD' | null>(null);
  const [flash, setFlash] = useState('');
  const [marketWarning, setMarketWarning] = useState('');
  const requiredScope = pageReadScope(pathname);
  const hasState = coversScope(state, requiredScope);
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Map<string, string>());

  useEffect(() => {
    if (unauthorized) router.replace('/login');
  }, [unauthorized, router]);
  useEffect(() => {
    if (document.visibilityState === 'visible') void store.selectScope(requiredScope);
  }, [requiredScope, pathname, store]);
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === 'visible') void store.revalidate();
    };
    const timer = setInterval(revalidate, 60_000);
    const stopPolling = startWalletPolling(store);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      clearInterval(timer);
      stopPolling();
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [store]);
  useEffect(() => {
    if (!hasState) return;
    let active = true;
    void (async () => {
      try {
        const result = await store.syncMarketOnOpen();
        if (active && (result.failed || result.hasMore))
          setMarketWarning(
            'Certains cours sont indisponibles ; dernières valeurs et dates conservées.',
          );
      } catch {
        if (active)
          setMarketWarning(
            'Actualisation des cours indisponible ; dernières valeurs et dates conservées.',
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [hasState, store]);
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
    const result = await readApiResponse<{
      id?: string;
      rates?: number;
      prices?: number;
      securities?: { prices: number };
    }>(res, 'Confirmation d’enregistrement indisponible. Vérifiez les données avant de réessayer.');
    pending.current.delete(signature);
    setFlash(
      route.startsWith('securities/') || route.endsWith('/preview')
        ? ''
        : 'Enregistrement effectué.',
    );
    const quoteRefresh = route === 'market/refresh' || route === 'securities/refresh';
    if (
      !route.endsWith('/preview') &&
      (!quoteRefresh || result.rates || result.prices || result.securities?.prices)
    )
      await store.invalidate(
        route.startsWith('wallets') ||
          route === 'zerion/config' ||
          route === 'market/refresh' ||
          route === 'securities/refresh'
          ? 'live'
          : 'full',
      );
    return result;
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

  if (!state || !hasState)
    return error ? (
      <main className="error-page">
        <p role="alert">{error}</p>
        <button className="btn primary" onClick={() => void store.refresh(true)}>
          Réessayer
        </button>
      </main>
    ) : (
      <WorkspaceLoading fullPage pathname={pathname} />
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
      <div className="workspace-notifications">
        {error && (
          <div className="workspace-refresh refresh-error" role="alert">
            {error} Les dernières données restent affichées.{' '}
            <button className="text-link" onClick={() => void store.refresh(true)}>
              Réessayer
            </button>
          </div>
        )}
        {walletError && (
          <div className="workspace-refresh refresh-error" role="status">
            {walletError}
          </div>
        )}
        {marketWarning && (
          <div className="workspace-refresh refresh-error" role="status">
            {marketWarning}
          </div>
        )}
      </div>
      {children}
    </WorkspaceContext.Provider>
  );
}
