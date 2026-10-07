import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(['1', ''])('selects the deployment output for VERCEL=%s', async (vercel) => {
  vi.stubEnv('VERCEL', vercel);
  vi.resetModules();
  const { default: config } = await import('../../next.config');
  expect(config.output).toBe(vercel === '1' ? undefined : 'standalone');
  if (vercel === '1')
    expect(config.outputFileTracingIncludes?.['/api/cron/wallets']).toContain(
      'node_modules/@sparticuz/chromium/bin/**',
    );
  else expect(config.outputFileTracingIncludes?.['/*']).toContain('node_modules/playwright/**/*');
});
