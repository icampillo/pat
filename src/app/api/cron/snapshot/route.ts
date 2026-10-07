import { runCron } from '@/server/cron';
import { createPortfolioSnapshots } from '@/server/jobs/portfolio-snapshot';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export function GET(request: Request) {
  return runCron(request, 'snapshot', createPortfolioSnapshots);
}
