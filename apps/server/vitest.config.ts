import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';
import { assertSafeTestDatabaseUrl, resolveTestDatabaseUrl } from './src/test-support/test-database';

// Same repo-root .env the server loads (src/config/index.ts); real env wins.
const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDir, '../../.env') });

// The suite deletes every row it touches, so it never runs against the dev
// database: it gets its own (`<db>_test` by default), and refuses to start if
// the resolved name is not a test database. Setting DATABASE_URL here, before
// any test file imports Prisma, is what points the suite at it.
const testDatabaseUrl = resolveTestDatabaseUrl(process.env);
assertSafeTestDatabaseUrl(testDatabaseUrl, process.env);
process.env.DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    fileParallelism: false,
    env: { DATABASE_URL: testDatabaseUrl },
    globalSetup: ['./vitest.global-setup.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
