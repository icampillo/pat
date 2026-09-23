import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const globalDb = globalThis as unknown as { patrimoineDb?: PrismaClient };
export function db() {
  if (!globalDb.patrimoineDb) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurée');
    globalDb.patrimoineDb = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }
  return globalDb.patrimoineDb;
}
export type Db = ReturnType<typeof db>;
