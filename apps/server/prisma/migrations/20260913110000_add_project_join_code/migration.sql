-- Shareable workspace join code. Nullable: minted on first use by the owner
-- rather than backfilled, so existing projects keep working untouched.
ALTER TABLE "projects" ADD COLUMN "joinCode" TEXT;

-- Unique so a code can only ever resolve to exactly one workspace.
CREATE UNIQUE INDEX "projects_joinCode_key" ON "projects"("joinCode");
