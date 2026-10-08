import { db } from './db';
import { sleep, ZerionError } from './zerion';

// One shared gate, not one in-memory counter per serverless instance. Each attempt/page counts.
export async function reserveZerionRequest(advanced: boolean) {
  const delay = await db().$transaction(async (tx) => {
    const now = new Date(),
      day = now.toISOString().slice(0, 10);
    await tx.zerionQuota.upsert({
      where: { id: 'developer' },
      create: { id: 'developer', day, nextRequestAt: now },
      update: {},
    });
    const [quota] = await tx.$queryRaw<
      { day: string; requests: number; advanced: number; nextRequestAt: Date }[]
    >`SELECT * FROM "ZerionQuota" WHERE id = 'developer' FOR UPDATE`;
    const requests = quota.day === day ? quota.requests : 0,
      usedAdvanced = quota.day === day ? quota.advanced : 0;
    if (requests >= 1900 || (advanced && usedAdvanced >= 450)) throw new ZerionError('QUOTA');
    const at = Math.max(now.getTime(), quota.nextRequestAt.getTime());
    if (at - now.getTime() > 5000) throw new ZerionError('RATE_LIMIT', 5000);
    await tx.zerionQuota.update({
      where: { id: 'developer' },
      data: {
        day,
        requests: requests + 1,
        advanced: usedAdvanced + Number(advanced),
        nextRequestAt: new Date(at + 400),
      },
    });
    return at - now.getTime();
  });
  if (delay > 0) await sleep(delay);
}
