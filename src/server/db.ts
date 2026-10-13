import { performanceEnabled, sqlMetric } from './performance';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const globalDb = globalThis as unknown as { patrimoineDb?: PrismaClient };
export function db() {
  if (!globalDb.patrimoineDb) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurée');
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
      log: performanceEnabled() ? [{ emit: 'event', level: 'query' }] : [],
    });
    if (performanceEnabled()) client.$on('query', sqlMetric);
    globalDb.patrimoineDb = client;
  }
  return globalDb.patrimoineDb;
}
