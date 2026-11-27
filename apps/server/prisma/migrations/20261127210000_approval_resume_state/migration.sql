-- CreateEnum
CREATE TYPE "ApprovalResumeStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "resumeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resumeError" TEXT,
ADD COLUMN     "resumeResultId" TEXT,
ADD COLUMN     "resumeStatus" "ApprovalResumeStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "resumedAt" TIMESTAMP(3);

