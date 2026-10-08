import { expect, it } from 'vitest';
import { configureTestDatabase } from '../database-env';

it('overrides a stale production DIRECT_URL before Prisma can migrate', () => {
  const env = {
    DATABASE_URL_TEST: 'postgresql://localhost:55439/isolated_test',
    DATABASE_URL: 'postgresql://production.invalid/app',
    DIRECT_URL: 'postgresql://production.invalid/app',
  };
  expect(configureTestDatabase(env)).toBe(env.DATABASE_URL_TEST);
  expect(env.DATABASE_URL).toBe(env.DATABASE_URL_TEST);
  expect(env.DIRECT_URL).toBe(env.DATABASE_URL_TEST);
});

it.each([
  undefined,
  '',
  'invalid',
  'postgresql://localhost/production',
  'https://localhost/db_test',
])('refuses an invalid test database without changing the environment: %s', (DATABASE_URL_TEST) => {
  const env = { DATABASE_URL_TEST, DIRECT_URL: 'unchanged' };
  expect(() => configureTestDatabase(env)).toThrow();
  expect(env.DIRECT_URL).toBe('unchanged');
});
