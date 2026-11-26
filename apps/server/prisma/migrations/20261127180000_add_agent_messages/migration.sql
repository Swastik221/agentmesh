-- CreateEnum
CREATE TYPE "AgentMessageIntent" AS ENUM ('ASK', 'ANSWER', 'PROPOSE', 'ACKNOWLEDGE', 'HANDOFF', 'BLOCKED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "AgentMessageDeliveryState" AS ENUM ('PENDING', 'DELIVERED', 'ACKNOWLEDGED');

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "senderAgentId" TEXT NOT NULL,
    "recipientAgentId" TEXT NOT NULL,
    "taskId" TEXT,
    "intent" "AgentMessageIntent" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "inReplyToId" TEXT,
    "clientMessageId" TEXT NOT NULL,
    "deliveryState" "AgentMessageDeliveryState" NOT NULL DEFAULT 'PENDING',
    "deliveredAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_messages_recipientAgentId_deliveryState_idx" ON "agent_messages"("recipientAgentId", "deliveryState");

-- CreateIndex
CREATE INDEX "agent_messages_projectId_createdAt_idx" ON "agent_messages"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_messages_senderAgentId_clientMessageId_recipientAgent_key" ON "agent_messages"("senderAgentId", "clientMessageId", "recipientAgentId");

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_senderAgentId_fkey" FOREIGN KEY ("senderAgentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_recipientAgentId_fkey" FOREIGN KEY ("recipientAgentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

