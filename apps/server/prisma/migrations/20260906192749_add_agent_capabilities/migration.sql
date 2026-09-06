-- CreateTable
CREATE TABLE "agent_capabilities" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_capabilities_agentId_idx" ON "agent_capabilities"("agentId");

-- CreateIndex
CREATE INDEX "agent_capabilities_capability_idx" ON "agent_capabilities"("capability");

-- CreateIndex
CREATE UNIQUE INDEX "agent_capabilities_agentId_capability_key" ON "agent_capabilities"("agentId", "capability");

-- AddForeignKey
ALTER TABLE "agent_capabilities" ADD CONSTRAINT "agent_capabilities_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
