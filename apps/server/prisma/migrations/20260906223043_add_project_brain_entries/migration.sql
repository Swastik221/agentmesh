-- CreateEnum
CREATE TYPE "ProjectBrainEntryType" AS ENUM ('REQUIREMENT', 'DECISION', 'NOTE', 'CONSTRAINT');

-- CreateTable
CREATE TABLE "project_brain_entries" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "ProjectBrainEntryType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_brain_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_brain_entries_projectId_idx" ON "project_brain_entries"("projectId");

-- CreateIndex
CREATE INDEX "project_brain_entries_projectId_type_idx" ON "project_brain_entries"("projectId", "type");

-- CreateIndex
CREATE INDEX "project_brain_entries_authorId_idx" ON "project_brain_entries"("authorId");

-- AddForeignKey
ALTER TABLE "project_brain_entries" ADD CONSTRAINT "project_brain_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_brain_entries" ADD CONSTRAINT "project_brain_entries_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
