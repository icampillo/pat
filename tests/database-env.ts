// Always override Prisma's preferred DIRECT_URL as well as the application URL.
export function configureTestDatabase(env: Record<string, string | undefined> = process.env) {
  const value = env.DATABASE_URL_TEST;
  let url: URL;
  try {
    url = new URL(value || '');
  } catch {
    throw new Error('DATABASE_URL_TEST PostgreSQL dédiée requise.');
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.pathname.endsWith('_test'))
    throw new Error('Tests refusés : la base PostgreSQL doit se terminer par _test.');
  env.DATABASE_URL = value;
  env.DIRECT_URL = value;
  return value!;
}
