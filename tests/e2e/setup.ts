import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
export default async function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error('Base de test obligatoire.');
  process.env.DATABASE_URL = url;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
    windowsHide: true,
  });
  const { createUser } = await import('../../src/server/provision');
  const { db } = await import('../../src/server/db');
  // This setup is restricted above to the dedicated *_test database.
  await db().rateLimit.deleteMany();
  const email = `e2e-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID();
  await createUser('Utilisateur test', email, password);
  mkdirSync('.local', { recursive: true });
  writeFileSync('.local/e2e-access.json', JSON.stringify({ email, password }), { mode: 0o600 });
  const categoryEmail = `e2e-categories-${randomUUID()}@example.test`,
    categoryPassword = randomUUID();
  await createUser('Catégories test', categoryEmail, categoryPassword);
  writeFileSync(
    '.local/e2e-category-access.json',
    JSON.stringify({ email: categoryEmail, password: categoryPassword }),
    { mode: 0o600 },
  );
  const walletEmail = `e2e-wallet-${randomUUID()}@example.test`,
    walletPassword = randomUUID() + randomUUID();
  const owner = await createUser('Wallet test', walletEmail, walletPassword);
  const { command } = await import('../../src/server/portfolio');
  await command(
    owner.userId,
    'POST',
    ['fx-rates'],
    { eurUsd: '1.25', observedAt: new Date(Date.now() - 1000).toISOString() },
    randomUUID(),
    null,
  );
  const { walletCommand, syncWallet } = await import('../../src/server/wallets');
  const { normalizeDeBank } = await import('../../src/server/debank');
  const { address, total, tokens, protocols } = await import('../fixtures/debank');
  const { id } = (await walletCommand(
    owner.userId,
    'POST',
    ['wallets'],
    { address, label: 'Wallet synchronisé' },
    randomUUID(),
  )) as { id: string };
  const sample = normalizeDeBank(total, tokens, protocols);
  await syncWallet(id, async () => ({
    ...sample,
    tokens: [
      ...sample.tokens,
      {
        id: 'dust',
        chain: 'eth',
        symbol: 'DUST',
        name: 'Dust token',
        amount: '1',
        priceUsd: '0.5',
        valueUsd: '0.5',
      },
    ],
    positions: [
      ...sample.positions,
      {
        id: 'dust-position',
        protocol: 'Dust fixture',
        chain: 'eth',
        kind: 'Staked',
        description: null,
        assetsUsd: '0.5',
        debtUsd: '0',
        netUsd: '0.5',
        observedAt: null,
        unlockAt: null,
        supplies: [],
        borrows: [],
        rewards: [],
      },
    ],
    source: 'DEBANK_PUBLIC',
    rounded: true,
    updatedLabel: 'Data updated 1 min ago',
  }));
  await walletCommand(
    owner.userId,
    'PATCH',
    ['debank', 'config'],
    { mode: 'PUBLIC', enabled: false, intervalMinutes: 60 },
    randomUUID(),
  );
  writeFileSync(
    '.local/e2e-wallet-access.json',
    JSON.stringify({ email: walletEmail, password: walletPassword }),
    { mode: 0o600 },
  );
  await db().$disconnect();
}
