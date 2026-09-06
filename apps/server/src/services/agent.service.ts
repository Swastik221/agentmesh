import { prisma } from '../lib/prisma.js';

import { CreateAgentInput, UpdateAgentInput } from '../schemas/agent.schema.js';
import { NotFoundError, ForbiddenError } from '../errors/app-error.js';
import { Agent, AgentStatus } from '@prisma/client';

export class AgentService {
  async createAgent(projectId: string, input: CreateAgentInput): Promise<Agent> {
    // Rule 1: Project must exist
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundError(`Project with ID ${projectId} not found`);
    }

    // Rule 2: Owner must exist
    const owner = await prisma.user.findUnique({
      where: { id: input.ownerId },
    });
    if (!owner) {
      throw new NotFoundError(`User with ID ${input.ownerId} not found`);
    }

    // Rule 3: Owner must belong to project
    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: input.ownerId,
        },
      },
    });
    if (!membership) {
      throw new ForbiddenError(`User ${input.ownerId} is not a member of project ${projectId}`);
    }

    // Rule 4: Agent starts OFFLINE by default
    const agent = await prisma.agent.create({
      data: {
        projectId,
        ownerId: input.ownerId,
        name: input.name,
        provider: input.provider,
        status: AgentStatus.OFFLINE,
      },
    });

    return agent;
  }

  async listProjectAgents(projectId: string, capabilityQuery?: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundError(`Project with ID ${projectId} not found`);
    }

    const normalizedCap =
      capabilityQuery && capabilityQuery.trim() !== ''
        ? capabilityQuery.trim().toLowerCase()
        : undefined;

    return prisma.agent.findMany({
      where: {
        projectId,
        ...(normalizedCap && {
          capabilities: {
            some: {
              capability: normalizedCap,
            },
          },
        }),
      },
      include: {
        capabilities: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAgent(agentId: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        capabilities: true,
      },
    });
    if (!agent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }
    return agent;
  }

  async updateAgent(agentId: string, input: UpdateAgentInput): Promise<Agent> {
    const existingAgent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!existingAgent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }

    return prisma.agent.update({
      where: { id: agentId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.provider !== undefined && { provider: input.provider }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    const existingAgent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!existingAgent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }

    await prisma.agent.delete({
      where: { id: agentId },
    });
  }
}

export const agentService = new AgentService();
