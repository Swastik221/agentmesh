import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { WebSocketMessage } from '../websocket/websocket.types.js';
import { createTaskAssignedMessage } from '@agentmesh/agent-protocol';

export type AssignmentSource = 'HUMAN_PREFERENCE' | 'CAPABILITY_MATCH';

export interface AssignmentExplanation {
  matchedCapabilities?: string[];
  unmatchedCapabilities?: string[];
  categoryScores?: {
    languages?: number;
    frameworks?: number;
    tools?: number;
    domains?: number;
    taskTypes?: number;
  };
  workload?: number;
  reason?: string;
}

export interface AssignmentResultSuccess {
  assigned: true;
  taskId: string;
  agentId: string;
  source: AssignmentSource;
  score?: number;
  explanation?: AssignmentExplanation;
}

export interface AssignmentResultFailure {
  assigned: false;
  taskId: string;
  reason:
    | 'NO_ELIGIBLE_AGENT'
    | 'PREFERRED_AGENT_UNAVAILABLE'
    | 'PREFERRED_AGENT_UNAUTHORIZED'
    | 'TASK_ALREADY_ASSIGNED'
    | 'TASK_CANCELLED_OR_COMPLETED';
}

export type AssignmentResult = AssignmentResultSuccess | AssignmentResultFailure;

export class CoordinatorService {
  private async verifyProjectMembership(projectId: string, userId: string): Promise<void> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const isOwner = project.ownerId === userId;
    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!isOwner && !membership) {
      throw new ForbiddenError('User is not a member of this project');
    }
  }

  public scoreCapabilities(
    agentCapabilities: string[],
    requiredCapabilities: string[],
  ): {
    score: number;
    matchedCapabilities: string[];
    unmatchedCapabilities: string[];
  } {
    const normalizedAgentCaps = agentCapabilities.map((c) => c.trim().toLowerCase());

    if (requiredCapabilities.length === 0) {
      return {
        score: 100,
        matchedCapabilities: [],
        unmatchedCapabilities: [],
      };
    }

    const matchedCapabilities: string[] = [];
    const unmatchedCapabilities: string[] = [];

    const categoryWeights: Record<string, number> = {
      language: 40,
      framework: 25,
      tool: 15,
      domain: 10,
      tasktype: 10,
    };

    let totalWeight = 0;
    let earnedWeight = 0;

    for (const rawReqCap of requiredCapabilities) {
      const normalizedReq = rawReqCap.trim().toLowerCase();
      let category = 'general';
      let capName = normalizedReq;

      if (normalizedReq.includes(':')) {
        const parts = normalizedReq.split(':');
        category = parts[0];
        capName = parts.slice(1).join(':');
      }

      const weight = categoryWeights[category] || 20;
      totalWeight += weight;

      const isMatched = normalizedAgentCaps.some((agentCap) => {
        if (agentCap === normalizedReq) return true;
        if (agentCap.includes(':')) {
          const agentCapName = agentCap.split(':').slice(1).join(':');
          return agentCapName === capName || agentCapName === normalizedReq;
        }
        return agentCap === capName;
      });

      if (isMatched) {
        earnedWeight += weight;
        matchedCapabilities.push(rawReqCap);
      } else {
        unmatchedCapabilities.push(rawReqCap);
      }
    }

    const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;

    return {
      score,
      matchedCapabilities,
      unmatchedCapabilities,
    };
  }

  async assignTask(
    projectId: string,
    taskId: string,
    actorUserId: string,
    options?: { preferredAgentId?: string },
  ): Promise<AssignmentResult> {
    await this.verifyProjectMembership(projectId, actorUserId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        responsibilities: true,
      },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    if (task.status === 'CANCELLED' || task.status === 'COMPLETED') {
      return {
        assigned: false,
        taskId,
        reason: 'TASK_CANCELLED_OR_COMPLETED',
      };
    }

    if (task.responsibilities.length > 0) {
      return {
        assigned: false,
        taskId,
        reason: 'TASK_ALREADY_ASSIGNED',
      };
    }

    const effectivePreferredAgentId = options?.preferredAgentId || task.preferredAgentId;

    // 1. Human Preference Handling
    if (effectivePreferredAgentId) {
      const preferredAgent = await prisma.agent.findUnique({
        where: { id: effectivePreferredAgentId },
      });

      if (!preferredAgent || preferredAgent.projectId !== projectId) {
        return {
          assigned: false,
          taskId,
          reason: 'PREFERRED_AGENT_UNAUTHORIZED',
        };
      }

      if (preferredAgent.status !== 'ONLINE') {
        return {
          assigned: false,
          taskId,
          reason: 'PREFERRED_AGENT_UNAVAILABLE',
        };
      }

      const explanation: AssignmentExplanation = {
        reason: 'Assigned by explicit human developer preference',
      };

      const result = await this.commitAssignmentTransaction(
        projectId,
        taskId,
        preferredAgent.id,
        'HUMAN_PREFERENCE',
        100,
        explanation,
      );

      return result;
    }

    // 2. Capability Matching
    const eligibleAgents = await prisma.agent.findMany({
      where: {
        projectId,
        status: 'ONLINE',
      },
      include: {
        capabilities: true,
        executions: {
          where: {
            status: 'RUNNING',
          },
        },
      },
    });

    if (eligibleAgents.length === 0) {
      return {
        assigned: false,
        taskId,
        reason: 'NO_ELIGIBLE_AGENT',
      };
    }

    const scoredCandidates = eligibleAgents.map((agent) => {
      const agentCapStrings = agent.capabilities.map((c) => c.capability);
      const { score, matchedCapabilities, unmatchedCapabilities } = this.scoreCapabilities(
        agentCapStrings,
        task.requiredCapabilities,
      );
      const workload = agent.executions.length;

      return {
        agent,
        score,
        workload,
        matchedCapabilities,
        unmatchedCapabilities,
      };
    });

    // Deterministic Tie Breaking
    scoredCandidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.workload !== b.workload) {
        return a.workload - b.workload;
      }
      if (a.agent.createdAt.getTime() !== b.agent.createdAt.getTime()) {
        return a.agent.createdAt.getTime() - b.agent.createdAt.getTime();
      }
      return a.agent.id.localeCompare(b.agent.id);
    });

    const winner = scoredCandidates[0];

    const explanation: AssignmentExplanation = {
      matchedCapabilities: winner.matchedCapabilities,
      unmatchedCapabilities: winner.unmatchedCapabilities,
      workload: winner.workload,
      reason: `Assigned via capability match (score: ${winner.score}%)`,
    };

    return await this.commitAssignmentTransaction(
      projectId,
      taskId,
      winner.agent.id,
      'CAPABILITY_MATCH',
      winner.score,
      explanation,
    );
  }

  private async commitAssignmentTransaction(
    projectId: string,
    taskId: string,
    agentId: string,
    source: AssignmentSource,
    score: number,
    explanation: AssignmentExplanation,
  ): Promise<AssignmentResult> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT * FROM tasks WHERE "projectId" = ${projectId} FOR UPDATE`;

        const freshTask = await tx.task.findUnique({
          where: { id: taskId },
          include: { responsibilities: true },
        });

        if (!freshTask || freshTask.projectId !== projectId) {
          throw new NotFoundError('Task not found');
        }

        if (freshTask.responsibilities.length > 0) {
          return {
            assigned: false as const,
            taskId,
            reason: 'TASK_ALREADY_ASSIGNED' as const,
          };
        }

        const explanationJson = JSON.parse(JSON.stringify(explanation));

        await tx.taskResponsibility.create({
          data: {
            taskId,
            agentId,
            assignmentSource: source,
            assignmentExplanation: explanationJson,
          },
        });

        return {
          assigned: true as const,
          taskId,
          agentId,
          source,
          score,
          explanation,
        };
      });

      if (result.assigned) {
        const assignedMsg = createTaskAssignedMessage(
          {
            projectId,
            senderId: 'server',
            recipientId: agentId,
            taskId,
          },
          {
            taskId,
            agentId,
            assignmentSource: source,
            score,
            explanation: JSON.parse(JSON.stringify(explanation)),
          },
        );

        connectionManager.broadcastToProject(
          projectId,
          assignedMsg as unknown as WebSocketMessage,
        );
      }

      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          assigned: false,
          taskId,
          reason: 'TASK_ALREADY_ASSIGNED',
        };
      }
      throw error;
    }
  }
}

export const coordinatorService = new CoordinatorService();
