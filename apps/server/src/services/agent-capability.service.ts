import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { normalizeCapability } from '../schemas/agent-capability.schema.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../errors/app-error.js';
import { getProjectRole, PROJECT_MANAGER_ROLES } from '../auth/project-access.js';
import { deltaSequencerService } from './delta-sequencer.service.js';

export class AgentCapabilityService {
  /**
   * Loads the agent and checks the actor may act on it. Reading needs project
   * membership. Changing capabilities needs the agent's owner or a project
   * OWNER/ADMIN, since capabilities drive auto-assignment and the paid gate.
   */
  private async loadAgentForActor(agentId: string, actorUserId: string, mode: 'read' | 'manage') {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!agent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }
    const role = await getProjectRole(agent.projectId, actorUserId);
    if (mode === 'manage' && agent.ownerId !== actorUserId && !PROJECT_MANAGER_ROLES.includes(role)) {
      throw new ForbiddenError("Only the agent's owner or a project OWNER/ADMIN can change its capabilities");
    }
    return agent;
  }

  async addCapability(agentId: string, capabilityInput: string, actorUserId: string) {
    const agent = await this.loadAgentForActor(agentId, actorUserId, 'manage');

    try {
      const capabilityRecord = await prisma.agentCapability.create({
        data: {
          agentId,
          capability: capabilityInput,
        },
      });

      await deltaSequencerService.recordAndBroadcastDelta(agent.projectId, [
        {
          entity: 'agent',
          entityId: agentId,
          operation: 'updated',
          fields: { capabilityAdded: capabilityRecord.capability },
        },
      ]);

      return capabilityRecord;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError(
          `Capability '${capabilityInput}' is already attached to agent ${agentId}`,
        );
      }
      throw error;
    }
  }

  async listCapabilities(agentId: string, actorUserId: string) {
    await this.loadAgentForActor(agentId, actorUserId, 'read');

    const capabilities = await prisma.agentCapability.findMany({
      where: { agentId },
      orderBy: { capability: 'asc' },
    });

    return {
      agentId,
      capabilities: capabilities.map((c) => c.capability),
    };
  }

  async removeCapability(agentId: string, rawCapability: string, actorUserId: string) {
    const agent = await this.loadAgentForActor(agentId, actorUserId, 'manage');

    const normalizedCap = normalizeCapability(rawCapability);

    const existingCapability = await prisma.agentCapability.findUnique({
      where: {
        agentId_capability: {
          agentId,
          capability: normalizedCap,
        },
      },
    });

    if (!existingCapability) {
      throw new NotFoundError(`Capability '${normalizedCap}' not attached to agent ${agentId}`);
    }

    await prisma.agentCapability.delete({
      where: {
        id: existingCapability.id,
      },
    });

    await deltaSequencerService.recordAndBroadcastDelta(agent.projectId, [
      {
        entity: 'agent',
        entityId: agentId,
        operation: 'updated',
        fields: { capabilityRemoved: normalizedCap },
      },
    ]);
  }
}

export const agentCapabilityService = new AgentCapabilityService();
