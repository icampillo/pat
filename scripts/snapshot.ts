import 'dotenv/config';
import { db } from '../src/server/db';
import { runSnapshot } from '../src/server/portfolio-query';
const args = process.argv.slice(2),
  index = args.indexOf('--portfolio');
const portfolioId = index >= 0 ? args[index + 1] : undefined;
if (!portfolioId) throw new Error('Usage : pnpm snapshot --portfolio <uuid> [--daily]');
const daily = args.includes('--daily');
try {
  await runSnapshot(portfolioId, daily);
  console.log(daily ? 'Snapshot quotidien enregistré (ou déjà existant).' : 'Snapshot enregistré.');
} finally {
  await db().$disconnect();
}
