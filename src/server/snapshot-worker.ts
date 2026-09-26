import { db } from './db';
import { runSnapshot } from './portfolio';

const worker = globalThis as unknown as {
  snapshotTimer?: ReturnType<typeof setInterval>;
  snapshotRunning?: boolean;
};

export async function runDailySnapshots() {
  const portfolios = await db().portfolio.findMany({ select: { id: true } });
  for (const portfolio of portfolios) {
    try {
      // The database key uses each portfolio's local day and survives restarts.
      // Use the actual capture time: never backfill days the server was offline.
      await runSnapshot(portfolio.id, true);
    } catch {
      console.warn(JSON.stringify({ code: 'DAILY_SNAPSHOT_FAILED', portfolioId: portfolio.id }));
    }
  }
}

export function startSnapshotWorker() {
  if (worker.snapshotTimer) return;
  const tick = async () => {
    if (worker.snapshotRunning) return;
    worker.snapshotRunning = true;
    try {
      await runDailySnapshots();
    } catch {
      console.warn(JSON.stringify({ code: 'SNAPSHOT_WORKER_UNAVAILABLE' }));
    } finally {
      worker.snapshotRunning = false;
    }
  };
  worker.snapshotTimer = setInterval(() => {
    void tick();
  }, 60_000);
  worker.snapshotTimer.unref();
  void tick();
}
