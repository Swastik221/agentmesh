import { describe, expect, it } from 'vitest';
import {
  ALLOW_NON_TEST_DATABASE_ENV,
  assertSafeTestDatabaseUrl,
  deriveTestDatabaseUrl,
  resolveTestDatabaseUrl,
} from '../test-support/test-database.js';

const DEV_URL = 'postgresql://postgres:postgres@localhost:5432/agentmesh?schema=public';
const TEST_URL = 'postgresql://postgres:postgres@localhost:5432/agentmesh_test?schema=public';

describe('test database isolation', () => {
  it('derives <db>_test from the dev URL, keeping credentials and query', () => {
    expect(deriveTestDatabaseUrl(DEV_URL)).toBe(TEST_URL);
  });

  it('leaves a URL that already names a _test database unchanged', () => {
    expect(deriveTestDatabaseUrl(TEST_URL)).toBe(TEST_URL);
  });

  it('prefers TEST_DATABASE_URL over DATABASE_URL', () => {
    const explicit = 'postgresql://u:p@db:5432/custom_test';
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: explicit, DATABASE_URL: DEV_URL })).toBe(explicit);
    expect(resolveTestDatabaseUrl({ DATABASE_URL: DEV_URL })).toBe(TEST_URL);
  });

  it('fails clearly when no database is configured', () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow(/TEST_DATABASE_URL/);
  });

  it('refuses a database whose name does not end in _test', () => {
    expect(() => assertSafeTestDatabaseUrl(DEV_URL, {})).toThrow(/Refusing to run the server tests against database "agentmesh"/);
    expect(() => resolveAndGuard({ TEST_DATABASE_URL: DEV_URL })).toThrow(/Refusing/);
  });

  it('accepts a _test database', () => {
    expect(() => assertSafeTestDatabaseUrl(TEST_URL, {})).not.toThrow();
  });

  it('allows a non-test database only with the explicit opt-in', () => {
    expect(() => assertSafeTestDatabaseUrl(DEV_URL, { [ALLOW_NON_TEST_DATABASE_ENV]: '1' })).toThrow(/Refusing/);
    expect(() => assertSafeTestDatabaseUrl(DEV_URL, { [ALLOW_NON_TEST_DATABASE_ENV]: 'true' })).not.toThrow();
  });

  it('runs this suite against a _test database', () => {
    expect(() => assertSafeTestDatabaseUrl(process.env.DATABASE_URL ?? '', {})).not.toThrow();
  });
});

function resolveAndGuard(env: Record<string, string | undefined>): string {
  const url = resolveTestDatabaseUrl(env);
  assertSafeTestDatabaseUrl(url, env);
  return url;
}
