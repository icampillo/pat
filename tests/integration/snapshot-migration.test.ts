import 'dotenv/config';
import { configureTestDatabase } from '../database-env';
import { expect, it } from 'vitest';
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const url = configureTestDatabase();

it('keeps every legacy value and chooses one Paris reference per owner/day across portfolios', async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = 'migration_' + randomUUID().replaceAll('-', '');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    const migration = '20261009120000_automatic_snapshots';
    for (const name of (await readdir('prisma/migrations')).filter((n) => /^\d/.test(n)).sort()) {
      if (name >= migration) continue;
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    }
    const owner = randomUUID(),
      first = randomUUID(),
      second = randomUUID();
    await client.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,$1,$1,NOW())', [
      owner,
    ]);
    for (const id of [first, second])
      await client.query('INSERT INTO "Portfolio" (id,"ownerId") VALUES ($1,$2)', [id, owner]);
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const samples = [
      [ids[0], first, '2026-10-24T22:30:00Z', 'MANUAL', '100'],
      [ids[1], second, '2026-10-25T06:00:00Z', 'DAILY', '120'],
      [ids[2], first, '2026-10-25T15:00:00Z', 'MANUAL', '130'],
      [ids[3], first, '2026-10-25T18:00:00Z', 'DAILY', null],
      [ids[4], first, '2026-10-25T23:00:00Z', 'MANUAL', '150'],
    ];
    for (const row of samples)
      await client.query(
        `INSERT INTO "PortfolioSnapshot"
        (id,"portfolioId","capturedAt",kind,"totalEur","ledgerVersion","netFlowsEur",data)
        VALUES ($1,$2,$3,$4,$5,1,0,'{"preserved":true}')`,
        row,
      );
    const before = (await client.query('SELECT * FROM "PortfolioSnapshot" ORDER BY id')).rows;
    await client.query(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
    const after = (await client.query('SELECT * FROM "PortfolioSnapshot" ORDER BY id')).rows;
    expect(
      after.map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(
            ([key]) => !['referenceOwnerId', 'referenceDay'].includes(key),
          ),
        ),
      ),
    ).toEqual(before);
    const refs = after.filter((row) => row.referenceDay);
    expect(
      refs
        .map((row) => ({ id: row.id, day: row.referenceDay }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    ).toEqual([
      { id: ids[1], day: '2026-10-25' },
      { id: ids[4], day: '2026-10-26' },
    ]);
    await client.query('SAVEPOINT duplicate');
    await expect(
      client.query(
        `UPDATE "PortfolioSnapshot"
      SET "referenceOwnerId"=$1,"referenceDay"='2026-10-25' WHERE id=$2`,
        [owner, ids[0]],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT duplicate');
    await expect(
      client.query(
        `INSERT INTO "PortfolioSnapshot"
      (id,"portfolioId",kind,"ledgerVersion","netFlowsEur",data) VALUES ($1,$2,'DAILY',1,0,'{}')`,
        [randomUUID(), first],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
