-- AlterTable
ALTER TABLE "task_responsibilities" ADD COLUMN     "assignmentExplanation" JSONB,
ADD COLUMN     "assignmentSource" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "preferredAgentId" TEXT,
ADD COLUMN     "requiredCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "tasks_preferredAgentId_idx" ON "tasks"("preferredAgentId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_preferredAgentId_fkey" FOREIGN KEY ("preferredAgentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
