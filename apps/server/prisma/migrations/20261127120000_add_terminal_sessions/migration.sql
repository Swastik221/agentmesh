-- CreateEnum
CREATE TYPE "TerminalVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- CreateEnum
CREATE TYPE "TerminalSessionStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'CLOSED');

-- CreateTable
CREATE TABLE "terminal_sessions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "agentId" TEXT,
    "name" TEXT NOT NULL,
    "command" TEXT,
    "cwd" TEXT,
    "visibility" "TerminalVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "TerminalSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "cols" INTEGER,
    "rows" INTEGER,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "terminal_sessions_projectId_status_idx" ON "terminal_sessions"("projectId", "status");

-- CreateIndex
CREATE INDEX "terminal_sessions_ownerUserId_idx" ON "terminal_sessions"("ownerUserId");

-- CreateIndex
CREATE INDEX "terminal_sessions_agentId_idx" ON "terminal_sessions"("agentId");

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

