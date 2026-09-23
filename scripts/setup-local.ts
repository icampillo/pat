import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) throw new Error('.env existe déjà. Aucun fichier modifié.');
const password = randomBytes(24).toString('hex');
mkdirSync('.local', { recursive: true });
writeFileSync(
  '.env',
  [
    `DATABASE_URL=postgresql://patrimoine:${password}@127.0.0.1:55432/patrimoine`,
    `DATABASE_URL_TEST=postgresql://patrimoine:${password}@127.0.0.1:55432/patrimoine_test`,
    `BETTER_AUTH_SECRET=${randomBytes(48).toString('hex')}`,
    'BETTER_AUTH_URL=http://localhost:3000',
    'APP_ORIGIN=http://localhost:3000',
    'POSTGRES_USER=patrimoine',
    `POSTGRES_PASSWORD=${password}`,
    'POSTGRES_DB=patrimoine',
    '',
  ].join('\n'),
  { mode: 0o600 },
);
console.log('Configuration locale créée. Démarrez pnpm db:local dans un terminal dédié.');
