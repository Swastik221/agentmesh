-- AlterTable
ALTER TABLE "project_brain_entries" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
