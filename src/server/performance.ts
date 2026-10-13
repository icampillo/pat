import { createHash } from 'node:crypto';

// Explicit opt-in, impossible to enable in production. No URLs, IDs, payloads or SQL parameters.
export const performanceEnabled = () =>
  process.env.NODE_ENV === 'development' && process.env.PATRIMOINE_PERF === '1';
const counts = new Map<string, number>();
export function performanceMetric(kind: string, name: string, durationMs: number, bytes?: number) {
  if (!performanceEnabled()) return;
  const key = `${kind}:${name}`;
  const count = (counts.get(key) ?? 0) + 1;
  counts.set(key, count);
  console.info(
    JSON.stringify({
      perf: kind,
      name,
      count,
      durationMs: Math.round(durationMs),
      ...(bytes !== undefined ? { responseBytes: bytes } : {}),
    }),
  );
}
export function sqlMetric(event: { query: string; duration: number }) {
  // Fingerprints identify repeated statements without exposing SQL literals or bound values.
  const table =
    [
      'PortfolioSnapshot',
      'WalletObservation',
      'WalletConnection',
      'Transaction',
      'PriceHistory',
      'Asset',
      'Session',
    ].find((name) => event.query.includes(`"${name}"`)) ?? 'Other';
  const operation =
    event.query
      .match(/^\s*(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/i)?.[1]
      .toUpperCase() ?? 'OTHER';
  performanceMetric(
    'sql',
    `${table}.${operation}.${createHash('sha256').update(event.query).digest('hex').slice(0, 16)}`,
    event.duration,
  );
}
export async function measureRead<T>(name: string, read: () => Promise<T>): Promise<T> {
  if (!performanceEnabled()) return read();
  const start = performance.now();
  try {
    return await read();
  } finally {
    performanceMetric('read', name, performance.now() - start);
  }
}
export async function measureHttp(request: Request, run: () => Promise<Response>) {
  if (!performanceEnabled()) return run();
  const url = new URL(request.url);
  // A fixed allowlist prevents wallet addresses/IDs/query strings reaching logs.
  const path = ['/api/v1/state', '/api/v1/wallets/status', '/api/v1/market/refresh'].includes(
    url.pathname,
  )
    ? url.pathname +
      (url.pathname === '/api/v1/state' && url.searchParams.get('scope') === 'live' ? ':live' : '')
    : '/api/v1/other';
  const start = performance.now();
  const response = await run();
  const bytes = (await response.clone().arrayBuffer()).byteLength;
  performanceMetric('http', `${request.method} ${path}`, performance.now() - start, bytes);
  return response;
}
