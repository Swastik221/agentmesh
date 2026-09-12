import { prisma } from '../lib/prisma.js';

import { CreateAgentInput, UpdateAgentInput } from '../schemas/agent.schema.js';
import { NotFoundError, ForbiddenError } from '../errors/app-error.js';
import { Agent, AgentStatus } from '@prisma/client';
import { ensService } from './ens.service.js';
import { deltaSequencerService } from './delta-sequencer.service.js';

/**
 * `agent` is already a valid entity in the protocol's delta schema
 * (`workspaceDeltaChangeSchema`), confirmed by grep, but nothing here ever
 * emitted it: an agent's own row (status flips driven by execution activity,
 * capability edits, renames) was invisible to every connected client in
 * real time. Uses the exact mechanism `task.service.ts` already uses for
 * `task`/`taskResponsibility` deltas, no new protocol surface.
 */

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

  /**
   * Create an agent. If ensName is supplied, the server resolves it and verifies the
   * resolved address matches authenticatedWallet before persisting. The client-supplied
   * ensAddress is never trusted.
   */
  async createAgent(
    projectId: string,
    actorUserId: string,
    input: CreateAgentInput,
    authenticatedWallet?: string | null,
  ): Promise<Agent> {
    // Rule 1: Project & membership check
    await this.verifyProjectMembership(projectId, actorUserId);

    // Rule 2: Optional ENS verification — happens before DB write (atomicity)
    let ensFields: {
      ensName?: string | null;
      ensAddress?: string | null;
      ensVerifiedAt?: Date | null;
    } = {};

    if (input.ensName) {
      if (!authenticatedWallet) {
        throw new ForbiddenError('Cannot attach ENS identity: authenticated wallet is not set');
      }
      const identity = await ensService.verifyNameOwnership(input.ensName, authenticatedWallet);
      ensFields = {
        ensName: identity.name,
        ensAddress: identity.address,
        ensVerifiedAt: new Date(),
      };
    }

    // Rule 3: Persist — only after successful verification
    const agent = await prisma.agent.create({
      data: {
        projectId,
        ownerId: actorUserId,
        name: input.name,
        provider: input.provider,
        status: AgentStatus.OFFLINE,
        ...ensFields,
      },
    });

    await deltaSequencerService.recordAndBroadcastDelta(projectId, [
      {
        entity: 'agent',
        entityId: agent.id,
        operation: 'created',
        fields: { name: agent.name, provider: agent.provider, status: agent.status },
      },
    ]);

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

  /**
   * Update an agent. ENS handling:
   *   - ensName = string  → resolve + verify → replace existing identity atomically
   *   - ensName = null    → explicitly remove all ENS fields
   *   - ensName absent    → no ENS change
   */
  async updateAgent(
    agentId: string,
    actorUserId: string,
    input: UpdateAgentInput,
    authenticatedWallet?: string | null,
  ): Promise<Agent> {
    const existingAgent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!existingAgent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }
    await this.verifyProjectMembership(existingAgent.projectId, actorUserId);

    if (existingAgent.ownerId !== actorUserId) {
      const project = await prisma.project.findUnique({ where: { id: existingAgent.projectId } });
      if (!project || project.ownerId !== actorUserId) {
        throw new ForbiddenError('Only the agent owner or project owner can modify this agent');
      }
    }

    // Build ENS update fields before touching the DB
    let ensUpdate: {
      ensName?: string | null;
      ensAddress?: string | null;
      ensVerifiedAt?: Date | null;
    } = {};

    if ('ensName' in input) {
      if (input.ensName === null) {
        // Explicit removal — no ENS lookup needed
        ensUpdate = { ensName: null, ensAddress: null, ensVerifiedAt: null };
      } else if (input.ensName) {
        if (!authenticatedWallet) {
          throw new ForbiddenError('Cannot attach ENS identity: authenticated wallet is not set');
        }
        // Resolve + verify before DB write
        const identity = await ensService.verifyNameOwnership(input.ensName, authenticatedWallet);
        ensUpdate = {
          ensName: identity.name,
          ensAddress: identity.address,
          ensVerifiedAt: new Date(),
        };
      }
    }

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.provider !== undefined && { provider: input.provider }),
        ...(input.status !== undefined && { status: input.status }),
        ...ensUpdate,
      },
    });

    await deltaSequencerService.recordAndBroadcastDelta(existingAgent.projectId, [
      {
        entity: 'agent',
        entityId: agentId,
        operation: 'updated',
        fields: { name: updated.name, provider: updated.provider, status: updated.status },
      },
    ]);

    return updated;
  }

  async deleteAgent(agentId: string, actorUserId: string): Promise<void> {
    const existingAgent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!existingAgent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found`);
    }
    await this.verifyProjectMembership(existingAgent.projectId, actorUserId);

    if (existingAgent.ownerId !== actorUserId) {
      const project = await prisma.project.findUnique({ where: { id: existingAgent.projectId } });
      if (!project || project.ownerId !== actorUserId) {
        throw new ForbiddenError('Only the agent owner or project owner can delete this agent');
      }
    }

    await prisma.agent.delete({
      where: { id: agentId },
    });

    await deltaSequencerService.recordAndBroadcastDelta(existingAgent.projectId, [
      {
        entity: 'agent',
        entityId: agentId,
        operation: 'removed',
        fields: {},
      },
    ]);
  }
}

export const agentService = new AgentService();
