import 'dotenv/config';
import { configureTestDatabase } from '../database-env';
import { expect, it } from 'vitest';
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const url = configureTestDatabase();

it('removes both categories atomically, preserves records and isolates portfolios on repeated runs', async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = 'migration_' + randomUUID().replaceAll('-', '');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    const migration = '20261012160000_remove_tcg_categories';
    for (const name of (await readdir('prisma/migrations')).filter((n) => /^\d/.test(n)).sort()) {
      if (name >= migration) continue;
      await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    }
    await client.query(`INSERT INTO "Currency" (code,name,symbol) VALUES ('EUR','Euro','€')`);
    const portfolios = [randomUUID(), randomUUID(), randomUUID()];
    const existingOther = randomUUID();
    for (const portfolio of portfolios) {
      const owner = randomUUID();
      await client.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,$1,$1,NOW())', [
        owner,
      ]);
      await client.query('INSERT INTO "Portfolio" (id,"ownerId") VALUES ($1,$2)', [
        portfolio,
        owner,
      ]);
      // The second portfolio has no OTHER category; the third has no retired categories.
      const keys = portfolio === portfolios[2] ? ['OTHER'] : ['POKEMON', 'ONE_PIECE'];
      if (portfolio === portfolios[0]) keys.push('OTHER');
      for (const key of keys) {
        const categoryId =
          portfolio === portfolios[0] && key === 'OTHER' ? existingOther : randomUUID();
        await client.query(
          'INSERT INTO "AssetCategory" (id,"portfolioId",key,label,color) VALUES ($1,$2,$3,$3,$4)',
          [categoryId, portfolio, key, '#123456'],
        );
        const assetId = randomUUID();
        await client.query(
          `INSERT INTO "Asset" (id,"portfolioId","categoryId",name,symbol,currency,metadata)
          VALUES ($1,$2,$3,'Test','TEST','EUR','{"setName":"Legacy"}')`,
          [assetId, portfolio, categoryId],
        );
        await client.query(
          `INSERT INTO "Transaction" (id,"portfolioId","assetId",type,quantity,"unitPrice",fees,amount,currency,"fxToEur","fxToUsd",platform,"occurredAt")
          VALUES ($1,$2,$3,'BUY',1,10,0,10,'EUR',1,1.2,'Test',NOW())`,
          [randomUUID(), portfolio, assetId],
        );
        await client.query(
          `INSERT INTO "PriceHistory" (id,"portfolioId","assetId",price,currency,"observedAt")
          VALUES ($1,$2,$3,20,'EUR',NOW())`,
          [randomUUID(), portfolio, assetId],
        );
        await client.query(
          `INSERT INTO "AssetImage" ("assetId","portfolioId",content,"updatedAt") VALUES ($1,$2,$3,NOW())`,
          [assetId, portfolio, Buffer.from('image')],
        );
      }
      await client.query(
        `INSERT INTO "PortfolioSnapshot" (id,"portfolioId",kind,"ledgerVersion","netFlowsEur",data)
        VALUES ($1,$2,'SEED',0,0,'{"preserved":true}')`,
        [randomUUID(), portfolio],
      );
    }
    const records = async () => {
      const data: Record<string, unknown> = {};
      for (const table of ['Transaction', 'PriceHistory', 'AssetImage', 'PortfolioSnapshot'])
        data[table] = (await client.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows;
      return data;
    };
    const before = await records();
    const assetsBefore = (await client.query('SELECT * FROM "Asset" ORDER BY id')).rows;
    const sql = await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8');
    await client.query(sql);
    const categories = (await client.query('SELECT * FROM "AssetCategory" ORDER BY id')).rows;
    expect(categories).toHaveLength(3);
    expect(categories.every((c) => c.key === 'OTHER')).toBe(true);
    expect(categories.find((c) => c.id === existingOther)).toMatchObject({
      label: 'OTHER',
      color: '#123456',
    });
    const after = (await client.query('SELECT * FROM "Asset" ORDER BY id')).rows;
    expect(after).toEqual(
      assetsBefore.map((asset) => {
        const categoryId = categories.find((c) => c.portfolioId === asset.portfolioId).id;
        return {
          ...asset,
          categoryId,
          version: asset.version + (categoryId === asset.categoryId ? 0 : 1),
        };
      }),
    );
    expect(await records()).toEqual(before);
    const versions = (await client.query('SELECT id,version FROM "Portfolio" ORDER BY id')).rows;
    expect(versions.find((p) => p.id === portfolios[2]).version).toBe(0);
    expect(versions.filter((p) => p.id !== portfolios[2]).map((p) => p.version)).toEqual([1, 1]);
    await client.query(sql);
    expect((await client.query('SELECT * FROM "Asset" ORDER BY id')).rows).toEqual(after);
    expect((await client.query('SELECT * FROM "AssetCategory" ORDER BY id')).rows).toEqual(
      categories,
    );
    expect((await client.query('SELECT id,version FROM "Portfolio" ORDER BY id')).rows).toEqual(
      versions,
    );
    expect(await records()).toEqual(before);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
