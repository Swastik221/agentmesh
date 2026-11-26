import { beforeEach, vi } from 'vitest';
import { assertSafeTestDatabaseUrl } from './src/test-support/test-database';
import { TEST_FACILITATOR_FEE_PAYER } from './src/test-support/payments';
import { x402Service } from './src/payments/x402.service';

// Runs in every test worker before the test file is imported: a last check,
// right where Prisma will read it, that DATABASE_URL is a test database.
assertSafeTestDatabaseUrl(process.env.DATABASE_URL ?? '', process.env);

// Issuing an x402 requirement asks the facilitator which fee payer it
// manages. Tests must not call the real facilitator over the network, so each
// test starts with that lookup answering a fixed, obviously fake account.
// Tests of the lookup itself restore the real method.
beforeEach(() => {
  vi.spyOn(x402Service, 'getFacilitatorFeePayer').mockResolvedValue(TEST_FACILITATOR_FEE_PAYER);
});
