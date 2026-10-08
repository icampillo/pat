import 'dotenv/config';
import { expect, it } from 'vitest';
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const url = process.env.DATABASE_URL_TEST;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Base de test requise.');
it('backfills preferences without changing any wallet, old observation, snapshot or encrypted legacy configuration', async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = `migration_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "Portfolio" (id UUID PRIMARY KEY);
      CREATE TABLE "DeBankConfig" ("portfolioId" UUID PRIMARY KEY, enabled BOOLEAN, "encryptedKey" TEXT, mode TEXT, "intervalMinutes" INTEGER);
      CREATE TABLE "WalletConnection" (id UUID PRIMARY KEY, address TEXT, label TEXT, included BOOLEAN);
      CREATE TABLE "WalletObservation" (id UUID PRIMARY KEY, data JSONB);
      CREATE TABLE "PortfolioSnapshot" (id UUID PRIMARY KEY, "dailyKey" TEXT, data JSONB);
    `);
    const id = randomUUID();
    await client.query('INSERT INTO "Portfolio" VALUES ($1)', [id]);
    await client.query('INSERT INTO "DeBankConfig" VALUES ($1, false, $2, $3, 15)', [
      id,
      'opaque-legacy-fixture',
      'API',
    ]);
    await client.query('INSERT INTO "WalletConnection" VALUES ($1, $2, $3, true)', [
      id,
      `0x${'a'.repeat(40)}`,
      'Existing label',
    ]);
    await client.query('INSERT INTO "WalletObservation" VALUES ($1, $2)', [
      id,
      { source: 'DEBANK_PUBLIC', totalUsd: '999.123' },
    ]);
    await client.query('INSERT INTO "PortfolioSnapshot" VALUES ($1, $2, $3)', [
      id,
      '2026-10-07',
      { totalUsd: '999.123' },
    ]);
    const tables = ['DeBankConfig', 'WalletConnection', 'WalletObservation', 'PortfolioSnapshot'];
    const before = await Promise.all(
      tables.map(async (table) => (await client.query(`SELECT * FROM "${table}"`)).rows),
    );
    await client.query(
      await readFile('prisma/migrations/20261008180000_zerion/migration.sql', 'utf8'),
    );
    const after = await Promise.all(
      tables.map(async (table) => (await client.query(`SELECT * FROM "${table}"`)).rows),
    );
    expect(after).toEqual(before);
    expect(
      (await client.query('SELECT "portfolioId", enabled, revision FROM "WalletSyncConfig"')).rows,
    ).toEqual([{ portfolioId: id, enabled: false, revision: 1 }]);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
