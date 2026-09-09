import { prisma } from '../lib/prisma.js';

import { CreateAgentInput, UpdateAgentInput } from '../schemas/agent.schema.js';
import { NotFoundError, ForbiddenError } from '../errors/app-error.js';
import { Agent, AgentStatus } from '@prisma/client';

export class AgentService {
  private async verifyProjectMembership(projectId: string, userId: string): Promise<void> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundError(`Project with ID ${projectId} not found`);
    }

    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });
    if (!membership) {
      throw new ForbiddenError(`User ${userId} is not a member of project ${projectId}`);
    }
  }

  async createAgent(projectId: string, actorUserId: string, input: CreateAgentInput): Promise<Agent> {
    // Rule 1: Project & membership check
    await this.verifyProjectMembership(projectId, actorUserId);

    // Rule 2: Agent starts OFFLINE by default
    const agent = await prisma.agent.create({
      data: {
        projectId,
        ownerId: actorUserId,
        name: input.name,
        provider: input.provider,
        status: AgentStatus.OFFLINE,
      },
    });

    return agent;
  }

  async listProjectAgents(projectId: string, actorUserId?: string, capabilityQuery?: string) {
    if (actorUserId) {
      await this.verifyProjectMembership(projectId, actorUserId);
    } else {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!project) {
        throw new NotFoundError(`Project with ID ${projectId} not found`);
      }
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

  async getAgent(agentId: string, actorUserId?: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        capabilities: true,
      },
    });
    if (!agent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }
    if (actorUserId) {
      await this.verifyProjectMembership(agent.projectId, actorUserId);
    }
    return agent;
  }

  async updateAgent(agentId: string, actorUserId: string, input: UpdateAgentInput): Promise<Agent> {
    const existingAgent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!existingAgent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }
    await this.verifyProjectMembership(existingAgent.projectId, actorUserId);

    return prisma.agent.update({
      where: { id: agentId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.provider !== undefined && { provider: input.provider }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
  }

  async deleteAgent(agentId: string, actorUserId: string): Promise<void> {
    const existingAgent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!existingAgent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }
    await this.verifyProjectMembership(existingAgent.projectId, actorUserId);

    await prisma.agent.delete({
      where: { id: agentId },
    });
  }
}

export const agentService = new AgentService();
