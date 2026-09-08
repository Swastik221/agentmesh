-- AlterTable
ALTER TABLE "task_dependencies" ADD COLUMN     "artifactId" TEXT,
ADD COLUMN     "dependencyType" TEXT NOT NULL DEFAULT 'TASK_COMPLETION',
ADD COLUMN     "projectId" TEXT,
ALTER COLUMN "dependsOnTaskId" DROP NOT NULL;

-- Backfill projectId for existing task_dependencies from tasks table
UPDATE "task_dependencies" td
SET "projectId" = t."projectId"
FROM "tasks" t
WHERE td."taskId" = t.id AND td."projectId" IS NULL;

-- Make projectId NOT NULL after backfill
ALTER TABLE "task_dependencies" ALTER COLUMN "projectId" SET NOT NULL;

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "executionId" TEXT,
    "agentId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "artifacts_projectId_idx" ON "artifacts"("projectId");

-- CreateIndex
CREATE INDEX "artifacts_taskId_idx" ON "artifacts"("taskId");

-- CreateIndex
CREATE INDEX "artifacts_agentId_idx" ON "artifacts"("agentId");

-- CreateIndex
CREATE INDEX "artifacts_executionId_idx" ON "artifacts"("executionId");

-- CreateIndex
CREATE INDEX "artifacts_ownerUserId_idx" ON "artifacts"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_taskId_name_version_key" ON "artifacts"("taskId", "name", "version");

-- CreateIndex
CREATE INDEX "task_dependencies_projectId_idx" ON "task_dependencies"("projectId");

-- CreateIndex
CREATE INDEX "task_dependencies_artifactId_idx" ON "task_dependencies"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_taskId_artifactId_key" ON "task_dependencies"("taskId", "artifactId");

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "task_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
