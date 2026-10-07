import { setTimeout as delay } from 'node:timers/promises';

// One retry only. Never forward provider bodies, URLs or credentials in errors.
export async function providerFetch(url: string, init: RequestInit = {}, timeoutMs = 10_000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      if (attempt === 1) throw new Error('PROVIDER_NETWORK');
      await delay(250);
      continue;
    }
    if (attempt === 1 || (response.status !== 429 && response.status < 500)) return response;
    const retryAfter = response.headers.get('retry-after');
    const waitMs = retryAfter
      ? /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Math.max(0, Date.parse(retryAfter) - Date.now())
      : 250;
    // Long provider backoffs are left to the next invocation, not slept inside a Function.
    if (!Number.isFinite(waitMs) || waitMs > 2000) return response;
    await response.body?.cancel();
    await delay(Math.max(250, waitMs));
  }
  throw new Error('PROVIDER_NETWORK');
}
