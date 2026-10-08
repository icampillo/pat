import type { AppState } from '@/shared/types';
import { readApiResponse } from './api';

export type WorkspaceData = AppState & { userName?: string };
const STALE_TIME = 60_000;

// One store per mounted workspace, never shared between sessions or persisted to disk.
export function createWorkspaceStore(initialData?: WorkspaceData) {
  let snapshot = {
    data: initialData,
    loading: false,
    error: '',
    unauthorized: false,
  };
  let receivedAt = initialData ? Date.parse(initialData.asOf) : 0;
  let controller: AbortController | undefined;
  let pending: Promise<void> | undefined;
  let openingSync: Promise<{ failed: number; hasMore: boolean }> | undefined;
  const listeners = new Set<() => void>();
  function publish(update: Partial<typeof snapshot>) {
    snapshot = { ...snapshot, ...update };
    listeners.forEach((listener) => listener());
  }
  function refresh(force = false): Promise<void> {
    if (!force && pending) return pending;
    if (!force && snapshot.data && Date.now() - receivedAt < STALE_TIME) return Promise.resolve();
    // A read begun before a successful write must never overwrite its revalidation.
    controller?.abort();
    const request = new AbortController();
    controller = request;
    publish({ loading: true, error: '' });
    pending = (async () => {
      const timeout = setTimeout(() => request.abort(), 30_000);
      try {
        const response = await fetch('/api/v1/state', {
          cache: 'no-store',
          signal: request.signal,
        });
        if (controller !== request) return;
        if (response.status === 401) {
          receivedAt = 0;
          publish({ data: undefined, unauthorized: true });
          return;
        }
        const result = await readApiResponse<WorkspaceData>(
          response,
          'Actualisation indisponible. Réessayez.',
        );
        if (controller !== request) return;
        receivedAt = Date.now();
        publish({ data: result, unauthorized: false });
      } catch (error) {
        if (controller !== request) return;
        publish({
          error: request.signal.aborted
            ? 'Le chargement prend trop de temps. Réessayez.'
            : error instanceof Error
              ? error.message
              : 'Chargement indisponible. Réessayez.',
        });
      } finally {
        clearTimeout(timeout);
        if (controller === request) {
          controller = undefined;
          pending = undefined;
          publish({ loading: false });
        } else if (pending) {
          // Concurrent saves must all wait for the newest post-write read.
          await pending;
        }
      }
    })();
    return pending;
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
    syncMarketOnOpen() {
      // The layout store survives navigation, focus and React Strict Mode effect replay.
      openingSync ??= fetch('/api/v1/market/refresh', {
        method: 'POST',
        signal: AbortSignal.timeout(240_000),
      }).then((response) =>
        readApiResponse<{ failed: number; hasMore: boolean }>(response, 'Cours indisponibles.'),
      );
      return openingSync;
    },
    cancel() {
      controller?.abort();
      controller = undefined;
      pending = undefined;
      publish({ loading: false });
    },
  };
}
