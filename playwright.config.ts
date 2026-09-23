import 'dotenv/config';
import { defineConfig } from '@playwright/test';
if (
  !process.env.DATABASE_URL_TEST ||
  !new URL(process.env.DATABASE_URL_TEST).pathname.endsWith('_test')
)
  throw new Error('DATABASE_URL_TEST dédiée requise.');
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3001',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev --port 3001',
    url: 'http://localhost:3001/login',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      BETTER_AUTH_URL: 'http://localhost:3001',
      APP_ORIGIN: 'http://localhost:3001',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_E2E: '1',
      WALLET_WORKER_DISABLED: '1',
      MARKET_WORKER_DISABLED: '1',
    },
  },
});
