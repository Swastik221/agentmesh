-- CreateTable
CREATE TABLE "agent_connect_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_connect_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_connect_tokens_tokenHash_key" ON "agent_connect_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "agent_connect_tokens_agentId_idx" ON "agent_connect_tokens"("agentId");

-- CreateIndex
CREATE INDEX "agent_connect_tokens_projectId_idx" ON "agent_connect_tokens"("projectId");

-- CreateIndex
CREATE INDEX "agent_connect_tokens_expiresAt_idx" ON "agent_connect_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "agent_connect_tokens" ADD CONSTRAINT "agent_connect_tokens_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connect_tokens" ADD CONSTRAINT "agent_connect_tokens_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_connect_tokens" ADD CONSTRAINT "agent_connect_tokens_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
