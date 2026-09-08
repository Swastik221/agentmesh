-- CreateEnum
CREATE TYPE "GitWorktreeStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- AlterTable
ALTER TABLE "project_workspaces" ADD COLUMN     "gitRepoPath" TEXT;

-- CreateTable
CREATE TABLE "git_worktrees" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "status" "GitWorktreeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_worktrees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "git_worktrees_executionId_key" ON "git_worktrees"("executionId");

-- CreateIndex
CREATE INDEX "git_worktrees_workspaceId_idx" ON "git_worktrees"("workspaceId");

-- CreateIndex
CREATE INDEX "git_worktrees_agentId_idx" ON "git_worktrees"("agentId");

-- CreateIndex
CREATE INDEX "git_worktrees_taskId_idx" ON "git_worktrees"("taskId");

-- CreateIndex
CREATE INDEX "git_worktrees_status_idx" ON "git_worktrees"("status");

-- AddForeignKey
ALTER TABLE "git_worktrees" ADD CONSTRAINT "git_worktrees_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "project_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_worktrees" ADD CONSTRAINT "git_worktrees_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "task_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_worktrees" ADD CONSTRAINT "git_worktrees_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_worktrees" ADD CONSTRAINT "git_worktrees_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
