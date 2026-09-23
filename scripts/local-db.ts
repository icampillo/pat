import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const connection = new URL(process.env.DATABASE_URL!);
if (connection.hostname !== '127.0.0.1' || connection.port !== '55432')
  throw new Error('Ce script est réservé au PostgreSQL local sur 127.0.0.1:55432.');
const databaseDir = '.local/postgres';
const cluster = new EmbeddedPostgres({
  databaseDir,
  user: connection.username,
  password: connection.password,
  port: 55432,
  persistent: true,
  authMethod: 'scram-sha-256',
  createPostgresUser: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: (message) => console.log(String(message).replaceAll(connection.password, '[secret]')),
  onError: (message) => console.error(String(message).replaceAll(connection.password, '[secret]')),
});
let stopCluster = () => cluster.stop();
if (process.platform === 'win32') {
  // pg_ctl lance PostgreSQL avec un jeton Windows restreint, sans créer de compte système.
  const requireEmbedded = createRequire(
    createRequire(import.meta.url).resolve('embedded-postgres'),
  );
  const binary = await import(
    pathToFileURL(requireEmbedded.resolve('@embedded-postgres/windows-x64')).href
  );
  const pgctl = join(dirname(binary.postgres), 'pg_ctl.exe');
  const run = (args: string[]) =>
    execFileSync(pgctl, args, { windowsHide: true, stdio: 'ignore', timeout: 90_000 });
  if (!existsSync(`${databaseDir}/PG_VERSION`)) {
    if (!/^[a-z_]+$/.test(connection.username)) throw new Error('Nom utilisateur local invalide.');
    writeFileSync('.local/init-password', connection.password + '\n', { mode: 0o600 });
    try {
      run([
        'initdb',
        '-D',
        databaseDir,
        '-o',
        `--username=${connection.username} --pwfile=.local/init-password --auth=scram-sha-256 --encoding=UTF8 --locale=C`,
      ]);
    } finally {
      unlinkSync('.local/init-password');
    }
  }
  let running = false;
  try {
    run(['status', '-D', databaseDir]);
    running = true;
  } catch {
    /* cluster arrêté */
  }
  if (!running)
    run([
      'start',
      '-D',
      databaseDir,
      '-l',
      '.local/postgres.log',
      '-o',
      '-h 127.0.0.1 -p 55432',
      '-w',
    ]);
  stopCluster = async () => {
    if (!running) run(['stop', '-D', databaseDir, '-m', 'fast', '-w']);
  };
  if (running) console.log('La base était déjà démarrée. Fermer ce terminal ne l’arrêtera pas.');
} else {
  if (!existsSync(`${databaseDir}/PG_VERSION`)) await cluster.initialise();
  await cluster.start();
}
const client = cluster.getPgClient('postgres', '127.0.0.1');
await client.connect();
for (const name of ['patrimoine', 'patrimoine_test']) {
  if (!(await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount) {
    await client.query(
      name === 'patrimoine' ? 'CREATE DATABASE patrimoine' : 'CREATE DATABASE patrimoine_test',
    );
  }
}
await client.end();
console.log('PostgreSQL local prêt sur 127.0.0.1:55432. Données conservées dans .local/postgres.');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await stopCluster();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 60_000);
