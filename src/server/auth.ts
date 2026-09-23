import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from './db';
function initializeAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith('REPLACE_'))
    throw new Error('Secret de session non configuré');
  return betterAuth({
    database: prismaAdapter(db(), { provider: 'postgresql' }),
    secret,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: [process.env.APP_ORIGIN || 'http://localhost:3000'],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
  });
}
let instance: ReturnType<typeof initializeAuth> | undefined;
export function auth() {
  return (instance ??= initializeAuth());
}
