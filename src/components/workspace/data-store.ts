import { coversScope, type WorkspaceState, type ReadScope } from '@/shared/types';
import { walletIsSyncing, type WalletSyncStatus } from '@/shared/wallets';
import { readApiResponse } from './api';

export type WorkspaceData = WorkspaceState & { userName?: string };
type Scope = ReadScope;
type MarketResult = {
  failed: number;
  hasMore: boolean;
  rates: number;
  prices: number;
  securities: { prices: number };
};
const STALE_TIME = 60_000;

// One store per mounted workspace, never shared between sessions or persisted to disk.
export function createWorkspaceStore(initialData?: WorkspaceData) {
  let snapshot = {
    data: initialData,
    loading: false,
    error: '',
    walletError: '',
    unauthorized: false,
  };
  let receivedAt = initialData ? Date.parse(initialData.asOf) : 0;
  let requiredScope: Scope = 'full';
  let revision = 0;
  let epoch = 0;
  let disposed = false;
  let controller: AbortController | undefined;
  let pending: Promise<void> | undefined;
  let queued: Scope | undefined;
  let openingSync: Promise<MarketResult> | undefined;
  let statusPending: Promise<void> | undefined;
  let statusController: AbortController | undefined;
  let statusAt = 0;
  const listeners = new Set<() => void>();
  function publish(update: Partial<typeof snapshot>) {
    snapshot = { ...snapshot, ...update };
    listeners.forEach((listener) => listener());
  }
  function cancel() {
    epoch++;
    disposed = true;
    controller?.abort();
    statusController?.abort();
    controller = statusController = undefined;
    pending = statusPending = undefined;
    queued = undefined;
    statusAt = 0;
    publish({ loading: false });
  }
  function expire() {
    cancel();
    receivedAt = 0;
    publish({ data: undefined, unauthorized: true });
  }
  function enqueue(scope: Scope) {
    const target =
      requiredScope === 'settings' || requiredScope === 'wallets' ? requiredScope : scope;
    if (queued === 'full' && target === 'live') return;
    queued = target === 'live' && !snapshot.data ? 'full' : target;
  }
  function drain(): Promise<void> {
    if (pending) return pending;
    const lifecycle = epoch;
    // Coalesce writes acknowledged in the same turn before starting an expensive read.
    pending = Promise.resolve().then(async () => {
      if (epoch !== lifecycle) return;
      publish({ loading: true, error: '' });
      try {
        while (queued && epoch === lifecycle) {
          const scope = queued;
          queued = undefined;
          const startedRevision = revision;
          const request = new AbortController();
          controller = request;
          const timeout = setTimeout(() => request.abort(), 30_000);
          try {
            const response = await fetch(
              `/api/v1/state${scope === 'full' ? '' : `?scope=${scope}`}`,
              {
                cache: 'no-store',
                signal: request.signal,
              },
            );
            if (epoch !== lifecycle) return;
            if (response.status === 401) {
              expire();
              return;
            }
            const result = await readApiResponse<WorkspaceData>(
              response,
              'Actualisation indisponible. Réessayez.',
            );
            if (epoch !== lifecycle) return;
            if (startedRevision !== revision) {
              // Never publish a pre-write response, nor cancel a SQL read merely to start another.
              enqueue(scope);
              continue;
            }
            receivedAt = Date.now();
            publish({
              data: scope === 'live' ? ({ ...snapshot.data!, ...result } as WorkspaceData) : result,
              unauthorized: false,
              error: '',
              walletError: '',
            });
            // Navigation may have changed while this narrower response was in flight.
            if (!coversScope(snapshot.data, requiredScope)) enqueue(requiredScope);
          } catch (error) {
            if (epoch !== lifecycle) return;
            if (startedRevision !== revision) {
              enqueue(scope);
              continue;
            }
            publish({
              error: request.signal.aborted
                ? 'Le chargement prend trop de temps. Réessayez.'
                : error instanceof Error
                  ? error.message
                  : 'Chargement indisponible. Réessayez.',
            });
          } finally {
            clearTimeout(timeout);
          }
        }
      } finally {
        if (epoch === lifecycle) {
          controller = undefined;
          pending = undefined;
          publish({ loading: false });
        }
      }
    });
    return pending;
  }
  function refresh(force = false): Promise<void> {
    disposed = false;
    if (pending) return pending;
    if (!force && coversScope(snapshot.data, requiredScope) && Date.now() - receivedAt < STALE_TIME)
      return Promise.resolve();
    enqueue(requiredScope);
    return drain();
  }
  function invalidate(scope: Scope = 'full'): Promise<void> {
    revision++;
    receivedAt = 0;
    enqueue(scope);
    return drain();
  }
  const syncing = () =>
    Boolean(
      snapshot.data?.onchain?.config.enabled && snapshot.data.onchain.wallets.some(walletIsSyncing),
    );

  function pollWallets(): Promise<void> {
    if (statusPending) return statusPending;
    if (pending) return pending;
    if (!syncing() || Date.now() - statusAt < 5_000) return Promise.resolve();
    const lifecycle = epoch;
    const startedRevision = revision;
    const data = snapshot.data;
    const request = new AbortController();
    statusController = request;
    statusAt = Date.now();
    statusPending = (async () => {
      const timeout = setTimeout(() => request.abort(), 15_000);
      try {
        const response = await fetch('/api/v1/wallets/status', {
          cache: 'no-store',
          signal: request.signal,
        });
        if (epoch !== lifecycle) return;
        if (response.status === 401) {
          expire();
          return;
        }
        const result = await readApiResponse<WalletSyncStatus>(
          response,
          'Suivi des wallets indisponible.',
        );
        // A concurrent mutation/read wins over an older status response.
        if (epoch !== lifecycle || revision !== startedRevision || snapshot.data !== data) return;
        const previous = data!.onchain.wallets;
        const changed =
          result.enabled !== data!.onchain.config.enabled ||
          result.wallets.length !== previous.length ||
          result.wallets.some((wallet) => {
            const before = previous.find((row) => row.id === wallet.id);
            return (
              !before ||
              before.enabled !== wallet.enabled ||
              before.lastSuccessAt !== wallet.lastSuccessAt ||
              (walletIsSyncing(before) && !walletIsSyncing(wallet))
            );
          });
        publish({ walletError: '' });
        if (changed) {
          // Acknowledge the transition only through a successful live read; failed reads retry.
          await invalidate('live');
        } else {
          publish({
            data: {
              ...data!,
              onchain: {
                ...data!.onchain,
                wallets: previous.map((wallet) => ({
                  ...wallet,
                  ...result.wallets.find((row) => row.id === wallet.id),
                })),
              },
            },
          });
        }
      } catch {
        if (epoch === lifecycle && revision === startedRevision && snapshot.data === data)
          publish({
            walletError: 'Suivi des wallets indisponible ; nouvelle tentative automatique.',
          });
      } finally {
        clearTimeout(timeout);
        if (epoch === lifecycle) {
          statusPending = undefined;
          statusController = undefined;
        }
      }
    })();
    return statusPending;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    selectScope(scope: Scope) {
      requiredScope = scope;
      return refresh();
    },
    invalidate,
    syncing,
    pollWallets,
    revalidate: () => {
      disposed = false;
      // Keep ordinary 60s freshness (other tabs, cron, future-dated transactions)
      // independent from status polling; a full read already includes wallet status.
      if (
        pending ||
        !coversScope(snapshot.data, requiredScope) ||
        Date.now() - receivedAt >= STALE_TIME
      )
        return refresh();
      return syncing() ? pollWallets() : refresh();
    },
    syncMarketOnOpen() {
      // The store survives navigation/focus/Strict Mode; no read when nothing was written.
      openingSync ??= fetch('/api/v1/market/refresh', {
        method: 'POST',
        signal: AbortSignal.timeout(240_000),
      })
        .then((response) => readApiResponse<MarketResult>(response, 'Cours indisponibles.'))
        .then(async (result) => {
          if (!disposed && (result.rates || result.prices || result.securities?.prices))
            await invalidate('live');
          return result;
        });
      return openingSync;
    },
    cancel,
  };
}
