import { timingSafeEqual } from 'node:crypto';
import { response } from './http';

export async function runCron<T extends { failed: number; hasMore: boolean }>(
  request: Request,
  name: string,
  job: () => Promise<T>,
) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  const actual = Buffer.from(authorization ?? '');
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return response({ error: 'UNAUTHORIZED' }, 401);
  const started = Date.now();
  console.info(JSON.stringify({ job: name, event: 'started' }));
  try {
    const result = await job();
    const ok = result.failed === 0 && !result.hasMore;
    const summary = {
      job: name,
      event: ok ? 'completed' : 'partial',
      ...result,
      durationMs: Date.now() - started,
    };
    console.info(JSON.stringify(summary));
    return response({ ok, ...summary }, ok ? 200 : 503);
  } catch {
    console.error(
      JSON.stringify({
        job: name,
        event: 'failed',
        code: 'JOB_FAILED',
        durationMs: Date.now() - started,
      }),
    );
    return response({ ok: false, error: 'JOB_FAILED' }, 503);
  }
}
