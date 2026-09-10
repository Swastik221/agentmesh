-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "ensAddress" TEXT,
ADD COLUMN     "ensName" TEXT,
ADD COLUMN     "ensVerifiedAt" TIMESTAMP(3);
