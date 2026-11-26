/**
 * Test database isolation.
 *
 * The server's integration tests empty tables with `deleteMany()` in their
 * setup and teardown. Run against the developer's dev database, that wipes
 * their data. These helpers pick a dedicated database for the test run and
 * refuse to run at all if the database it resolves to is not clearly a test
 * database.
 *
 * Used by `vitest.config.ts`, `vitest.global-setup.ts` and
 * `vitest.setup.ts`; nothing in the server runtime imports this module.
 */

/** Suffix every database the test suite may write to must end with. */
export const TEST_DATABASE_SUFFIX = '_test';

/**
 * Explicit opt-in to run the destructive suite against a database whose name
 * does not end in `_test`. Meant for CI setups that cannot name their
 * database; never set it locally.
 */
export const ALLOW_NON_TEST_DATABASE_ENV = 'AGENTMESH_TEST_ALLOW_NON_TEST_DATABASE';

type Env = Record<string, string | undefined>;

/** Returns the database name in a PostgreSQL connection URL. */
export const databaseNameFromUrl = (databaseUrl: string): string => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('Test database URL is not a valid connection URL.');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) {
    throw new Error('Test database URL does not name a database.');
  }
  return name;
};

/**
 * Derives the test database URL from a dev URL by suffixing the database name
 * with `_test`, keeping host, credentials and query (e.g. `?schema=public`).
 * A URL that already names a `_test` database is returned unchanged, so CI's
 * `agentmesh_test` does not become `agentmesh_test_test`.
 */
export const deriveTestDatabaseUrl = (databaseUrl: string): string => {
  const name = databaseNameFromUrl(databaseUrl);
  if (name.endsWith(TEST_DATABASE_SUFFIX)) return databaseUrl;
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(name + TEST_DATABASE_SUFFIX)}`;
  return url.toString();
};

/**
 * The database URL the test run uses: `TEST_DATABASE_URL` if set, otherwise
 * `DATABASE_URL` with its database name suffixed `_test`.
 */
export const resolveTestDatabaseUrl = (env: Env): string => {
  const explicit = env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const base = env.DATABASE_URL?.trim();
  if (!base) {
    throw new Error(
      'Server tests need a PostgreSQL database. Set TEST_DATABASE_URL, or DATABASE_URL ' +
        `(the tests then use that database name suffixed "${TEST_DATABASE_SUFFIX}").`,
    );
  }
  return deriveTestDatabaseUrl(base);
};

/**
 * Throws unless the URL names a database ending in `_test`, or the run has
 * explicitly opted out with AGENTMESH_TEST_ALLOW_NON_TEST_DATABASE=true.
 */
export const assertSafeTestDatabaseUrl = (databaseUrl: string, env: Env): void => {
  const name = databaseNameFromUrl(databaseUrl);
  if (name.endsWith(TEST_DATABASE_SUFFIX)) return;
  if (env[ALLOW_NON_TEST_DATABASE_ENV] === 'true') return;
  throw new Error(
    `Refusing to run the server tests against database "${name}": they delete every row in it. ` +
      `Point TEST_DATABASE_URL at a database whose name ends in "${TEST_DATABASE_SUFFIX}" ` +
      `(or unset it to use DATABASE_URL's database + "${TEST_DATABASE_SUFFIX}"). ` +
      `CI that cannot rename its database may set ${ALLOW_NON_TEST_DATABASE_ENV}=true.`,
  );
};
