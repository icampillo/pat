import type { NextConfig } from 'next';
const config: NextConfig = {
  ...(process.env.VERCEL !== '1' && { output: 'standalone' }),
  distDir: process.env.NEXT_E2E === '1' ? '.next-e2e' : '.next',
  devIndicators: false,
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
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
