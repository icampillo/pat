import 'dotenv/config';
import { db } from '../src/server/db';
import { backfillSnapshotSummaries } from '../src/server/snapshot-history';

// No automatic migration/backfill during startup, reads or builds. Run only after DB approval.
if (!process.argv.includes('--apply'))
  throw new Error('Explicit --apply required after database approval.');
const batchSize = Number(process.argv.find((arg) => arg.startsWith('--batch='))?.slice(8) ?? 100);
try {
  let total = 0;
  for (;;) {
    const updated = await backfillSnapshotSummaries(db(), batchSize);
    total += updated;
    console.info(JSON.stringify({ updated, total }));
    if (!updated) break;
  }
} finally {
  await db().$disconnect();
}
