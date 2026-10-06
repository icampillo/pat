import { defineConfig } from '@playwright/test';

// Production browser checks with deterministic API fixtures; no database or real account.
export default defineConfig({
  testDir: './tests/navigation',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3002',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3002',
    url: 'http://127.0.0.1:3002/login',
    reuseExistingServer: false,
    env: {
      VERCEL: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      WALLET_WORKER_DISABLED: '1',
      MARKET_WORKER_DISABLED: '1',
      SNAPSHOT_WORKER_DISABLED: '1',
    },
  },
});
