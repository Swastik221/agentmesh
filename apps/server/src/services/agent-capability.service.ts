import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { normalizeCapability } from '../schemas/agent-capability.schema.js';
import { NotFoundError, ConflictError } from '../errors/app-error.js';
import { deltaSequencerService } from './delta-sequencer.service.js';

export class AgentCapabilityService {
  async addCapability(agentId: string, capabilityInput: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!agent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }

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

  async listCapabilities(agentId: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!agent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }

    const capabilities = await prisma.agentCapability.findMany({
      where: { agentId },
      orderBy: { capability: 'asc' },
    });

    return {
      agentId,
      capabilities: capabilities.map((c) => c.capability),
    };
  }

  async removeCapability(agentId: string, rawCapability: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!agent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }

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
