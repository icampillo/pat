import 'dotenv/config';
import { fetchZerion, ZerionError, sleep } from '../src/server/zerion';
import { compareWalletCoverage } from '../src/server/wallet-coverage';
import { readFile } from 'node:fs/promises';
import { decimal as d, precise } from '../src/domain/money';
import type { WalletData } from '../src/shared/wallets';
const address = process.argv[2];
if (!address) throw new Error('Usage : pnpm wallet:check 0x… [observation-historique.json]');
try {
  let requests = 0,
    advancedRequests = 0;
  // Standalone diagnostic: never connects to or modifies the production database.
  const data = await fetchZerion(address, {
    reserve: async (advanced) => {
      if (++requests > 60 || (advanced && ++advancedRequests > 30)) throw new ZerionError('QUOTA');
      await sleep(400);
    },
  });
  const previous = process.argv[3]
    ? (JSON.parse(await readFile(process.argv[3], 'utf8')) as WalletData)
    : null;
  console.log(
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        requests,
        advancedRequests,
        ...data,
        comparison: previous
          ? {
              previousSource: previous.source || 'DEBANK_API',
              previousTotalUsd: previous.totalUsd,
              differenceUsd: precise(d(data.totalUsd).sub(previous.totalUsd)),
              warnings: compareWalletCoverage(previous, data),
              note: 'Comparer les dates de collecte ; un écart n’est pas une plus-value.',
            }
          : null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof ZerionError ? error.message : 'Validation Zerion impossible.');
  process.exitCode = 1;
}
