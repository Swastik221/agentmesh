-- Cache the verified primary ENS name for a user's wallet.
-- Nullable and unconstrained: a wallet with no primary name is the normal case,
-- and two rows may legitimately hold the same name only if the chain says so,
-- so no unique index here.
ALTER TABLE "users" ADD COLUMN "ensName" TEXT;
ALTER TABLE "users" ADD COLUMN "ensCheckedAt" TIMESTAMP(3);
