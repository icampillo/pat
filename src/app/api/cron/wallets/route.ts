import { runCron } from '@/server/cron';
import { syncDueWallets } from '@/server/wallets';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export function GET(request: Request) {
  return runCron(request, 'wallets', () => syncDueWallets());
}
