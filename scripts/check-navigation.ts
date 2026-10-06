import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Run after `VERCEL=1 npm run build`. Never connects to the user's database.
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const address = portProbe.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>((resolve) => portProbe.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
  {
    stdio: 'ignore',
    env: {
      ...process.env,
      VERCEL: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      WALLET_WORKER_DISABLED: '1',
      MARKET_WORKER_DISABLED: '1',
      SNAPSHOT_WORKER_DISABLED: '1',
      DATABASE_URL: 'postgresql://navigation_test:unused@127.0.0.1:1/navigation_test',
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      APP_ORIGIN: origin,
      BETTER_AUTH_URL: origin,
    },
  },
);
try {
  await once(server, 'spawn');
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert(server.exitCode === null, 'Server exited before becoming ready');
    try {
      ready = (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      /* Starting. */
    }
    if (ready) break;
    await delay(100);
  }
  assert(ready, 'Production server did not become ready');
  for (const path of [
    '/dashboard',
    '/portfolio',
    '/activity',
    '/settings',
    '/wallets',
    '/assets/test-asset',
    '/categories/crypto',
    '/transactions/test-transaction',
  ]) {
    const html = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
    assert.equal(html.status, 200, path);
    assert.match(await html.text(), /Chargement de votre patrimoine/, path);
    const rsc = await fetch(origin + path + '?_rsc=navigation-check', {
      headers: { RSC: '1' },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(rsc.status, 200, path);
    assert.match(rsc.headers.get('content-type') || '', /text\/x-component/, path);
    await rsc.text();
  }
  for (const path of [
    '/api/v1/state',
    '/api/v1/assets/test-asset/prices',
    '/api/v1/exports/assets.csv',
  ]) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
  }
  console.log(
    'HTTP OK: 8 HTML + 8 RSC routes without a database; 3 anonymous API reads refused (401, private/no-store).',
  );
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
}
