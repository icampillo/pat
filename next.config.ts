import type { NextConfig } from 'next';
const config: NextConfig = {
  // Vercel packages its own functions; standalone and browser assets are for Node/Docker.
  ...(process.env.VERCEL !== '1' && {
    output: 'standalone',
    outputFileTracingIncludes: {
      '/*': ['node_modules/playwright/**/*', 'node_modules/playwright-core/**/*'],
    },
  }),
  ...(process.env.VERCEL === '1' && {
    outputFileTracingIncludes: {
      '/api/cron/wallets': ['node_modules/@sparticuz/chromium/bin/**'],
      '/api/v1/*': ['node_modules/@sparticuz/chromium/bin/**'],
    },
  }),
  distDir: process.env.NEXT_E2E === '1' ? '.next-e2e' : '.next',
  devIndicators: false,
  poweredByHeader: false,
  serverExternalPackages: ['pg', 'playwright', 'playwright-core', '@sparticuz/chromium'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
