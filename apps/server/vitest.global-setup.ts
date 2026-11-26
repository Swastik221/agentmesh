import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeTestDatabaseUrl, databaseNameFromUrl } from './src/test-support/test-database';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Runs once before the suite: applies migrations to the test database
 * (`prisma migrate deploy` creates the database first if it does not exist).
 */
export default function setup(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('vitest.config.ts did not resolve a test database URL.');
  assertSafeTestDatabaseUrl(databaseUrl, process.env);

  const prismaBin = path.join(serverDir, 'node_modules', '.bin', 'prisma');
  const result = spawnSync(prismaBin, ['migrate', 'deploy'], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `Could not apply migrations to test database "${databaseNameFromUrl(databaseUrl)}".\n` +
        `${result.error?.message ?? ''}${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
}
