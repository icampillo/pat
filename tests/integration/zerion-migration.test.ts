import 'dotenv/config';
import { configureTestDatabase } from '../database-env';
import { expect, it } from 'vitest';
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const url = configureTestDatabase();
it('backfills preferences without changing any wallet, old observation, snapshot or encrypted legacy configuration', async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = `migration_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    // Recreate the real pre-Zerion schema, including every historical constraint.
    const migration = '20261008180000_zerion';
    for (const name of (await readdir('prisma/migrations'))
      .filter((name) => /^\d/.test(name))
      .sort()) {
      if (name >= migration) continue;
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    }
    const id = randomUUID();
    await client.query(
      'INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $2, $3, NOW())',
      [id, 'Legacy fixture', `${id}@example.test`],
    );
    await client.query('INSERT INTO "Portfolio" (id, "ownerId") VALUES ($1::uuid, $1::text)', [id]);
    await client.query(
      'INSERT INTO "DeBankConfig" ("portfolioId", enabled, "encryptedKey", mode, "intervalMinutes", "updatedAt") VALUES ($1, false, $2, $3, 15, NOW())',
      [id, 'opaque-legacy-fixture', 'API'],
    );
    await client.query(
      'INSERT INTO "WalletConnection" (id, "portfolioId", address, label, included) VALUES ($1, $1, $2, $3, true)',
      [id, `0x${'a'.repeat(40)}`, 'Existing label'],
    );
    await client.query(
      'INSERT INTO "WalletObservation" (id, "walletId", "totalUsd", data) VALUES ($1, $1, $2, $3)',
      [id, '999.123', { source: 'DEBANK_PUBLIC', totalUsd: '999.123' }],
    );
    await client.query(
      'INSERT INTO "PortfolioSnapshot" (id, "portfolioId", "dailyKey", "ledgerVersion", "investedEur", "netFlowsEur", "totalUsd", data) VALUES ($1, $1, $2, 1, 0, 0, $3, $4)',
      [id, '2026-10-07', '999.123', { totalUsd: '999.123' }],
    );
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
