import 'dotenv/config';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

const args = process.argv.slice(2),
  restore = args.includes('--restore');
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = resolve(
  arg('--file') || `backups/patrimoine-${new Date().toISOString().replaceAll(':', '-')}.dump`,
);
const connection = new URL(process.env.DATABASE_URL!);
const binaryDir =
  process.env.PGBIN ||
  (existsSync('.local/pg-tools/bin/pg_dump.exe') ? resolve('.local/pg-tools/bin') : '');
const executable = (name: string) =>
  binaryDir ? join(binaryDir, name + (process.platform === 'win32' ? '.exe' : '')) : name;
const env = {
  ...process.env,
  PGHOST: connection.hostname,
  PGPORT: connection.port || '5432',
  PGUSER: decodeURIComponent(connection.username),
  PGPASSWORD: decodeURIComponent(connection.password),
  ...(connection.searchParams.has('sslmode')
    ? { PGSSLMODE: connection.searchParams.get('sslmode')! }
    : {}),
};
try {
  if (restore) {
    const database = arg('--database');
    if (!existsSync(file) || !database || !/^patrimoine_restore_[a-z0-9_]+$/.test(database))
      throw new Error('Usage : pnpm db:restore --file <dump> --database patrimoine_restore_<nom>');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      if ((await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount)
        throw new Error('La base cible existe déjà : restauration refusée.');
      await client.query(`CREATE DATABASE "${database}"`);
    } finally {
      await client.end();
    }
    execFileSync(
      executable('pg_restore'),
      ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', database, file],
      { env, stdio: 'pipe', windowsHide: true },
    );
    console.log(`Restauration terminée dans ${database}. La base source est inchangée.`);
  } else {
    if (existsSync(file)) throw new Error('Le fichier existe déjà. Choisissez un nouveau chemin.');
    mkdirSync(dirname(file), { recursive: true });
    execFileSync(
      executable('pg_dump'),
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--file',
        file,
        '--dbname',
        connection.pathname.slice(1),
      ],
      { env, stdio: 'pipe', windowsHide: true },
    );
    console.log(`Sauvegarde privée créée : ${file}`);
  }
} catch (error) {
  // Les erreurs des outils peuvent contenir des chaînes de connexion : ne pas les recopier.
  if (error instanceof Error && !('status' in error)) console.error(error.message);
  else
    console.error(
      'Échec de l’outil PostgreSQL. Vérifiez la connexion, le chemin et la version des binaires.',
    );
  process.exitCode = 1;
}
