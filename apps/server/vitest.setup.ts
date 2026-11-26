import { assertSafeTestDatabaseUrl } from './src/test-support/test-database';

// Runs in every test worker before the test file is imported: a last check,
// right where Prisma will read it, that DATABASE_URL is a test database.
assertSafeTestDatabaseUrl(process.env.DATABASE_URL ?? '', process.env);
