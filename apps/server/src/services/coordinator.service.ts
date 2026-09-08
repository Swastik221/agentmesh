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

  public getCategoryKey(
    rawCap: string,
  ): 'languages' | 'frameworks' | 'tools' | 'domains' | 'taskTypes' {
    const norm = rawCap.trim().toLowerCase();
    if (norm.includes(':')) {
      const prefix = norm.split(':')[0];
      if (prefix === 'language' || prefix === 'languages' || prefix === 'lang') return 'languages';
      if (prefix === 'framework' || prefix === 'frameworks') return 'frameworks';
      if (prefix === 'tool' || prefix === 'tools') return 'tools';
      if (prefix === 'domain' || prefix === 'domains') return 'domains';
      if (prefix === 'tasktype' || prefix === 'tasktypes' || prefix === 'task_type')
        return 'taskTypes';
    }

    const name = norm.includes(':') ? norm.split(':').slice(1).join(':') : norm;
    if (['react', 'vue', 'angular', 'express', 'fastapi', 'next', 'django'].includes(name))
      return 'frameworks';
    if (['vite', 'docker', 'git', 'webpack', 'prisma'].includes(name)) return 'tools';
    if (['frontend', 'backend', 'fullstack', 'database', 'devops'].includes(name))
      return 'domains';
    if (['ui', 'api', 'bugfix', 'refactor', 'test'].includes(name)) return 'taskTypes';
    return 'languages';
  }

  public scoreCapabilities(
    agentCapabilities: string[],
    requiredCapabilities: string[],
  ): {
    score: number;
    matchedCapabilities: string[];
    unmatchedCapabilities: string[];
    categoryScores: {
      languages: number;
      frameworks: number;
      tools: number;
      domains: number;
      taskTypes: number;
    };
  } {
    const normalizedAgentCaps = agentCapabilities.map((c) => c.trim().toLowerCase());

    const categoryWeights = {
      languages: 40,
      frameworks: 25,
      tools: 15,
      domains: 10,
      taskTypes: 10,
    };

    if (requiredCapabilities.length === 0) {
      return {
        score: 100,
        matchedCapabilities: [],
        unmatchedCapabilities: [],
        categoryScores: {
          languages: 40,
          frameworks: 25,
          tools: 15,
          domains: 10,
          taskTypes: 10,
        },
      };
    }

    const reqsByCategory: Record<
      'languages' | 'frameworks' | 'tools' | 'domains' | 'taskTypes',
      string[]
    > = {
      languages: [],
      frameworks: [],
      tools: [],
      domains: [],
      taskTypes: [],
    };

    for (const rawReqCap of requiredCapabilities) {
      const cat = this.getCategoryKey(rawReqCap);
      reqsByCategory[cat].push(rawReqCap);
    }

    const matchedCapabilities: string[] = [];
    const unmatchedCapabilities: string[] = [];
    const categoryScores = {
      languages: 0,
      frameworks: 0,
      tools: 0,
      domains: 0,
      taskTypes: 0,
    };

    const categories: Array<'languages' | 'frameworks' | 'tools' | 'domains' | 'taskTypes'> = [
      'languages',
      'frameworks',
      'tools',
      'domains',
      'taskTypes',
    ];

    for (const cat of categories) {
      const reqs = reqsByCategory[cat];
      if (reqs.length === 0) {
        categoryScores[cat] = 0;
        continue;
      }

      let matchedInCat = 0;
      for (const rawReqCap of reqs) {
        const normalizedReq = rawReqCap.trim().toLowerCase();
        const capName = normalizedReq.includes(':')
          ? normalizedReq.split(':').slice(1).join(':')
          : normalizedReq;

        const isMatched = normalizedAgentCaps.some((agentCap) => {
          if (agentCap === normalizedReq) return true;
          if (agentCap.includes(':')) {
            const agentCapName = agentCap.split(':').slice(1).join(':');
            return agentCapName === capName || agentCapName === normalizedReq;
          }
          return agentCap === capName;
        });

        if (isMatched) {
          matchedInCat++;
          matchedCapabilities.push(rawReqCap);
        } else {
          unmatchedCapabilities.push(rawReqCap);
        }
      }

      const catWeight = categoryWeights[cat];
      categoryScores[cat] = Math.round((matchedInCat / reqs.length) * catWeight);
    }

    const rawFinalScore =
      categoryScores.languages +
      categoryScores.frameworks +
      categoryScores.tools +
      categoryScores.domains +
      categoryScores.taskTypes;

    const finalScore = Math.min(100, Math.max(0, rawFinalScore));

    return {
      score: finalScore,
      matchedCapabilities,
      unmatchedCapabilities,
      categoryScores,
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

    // 1. Human Preference Handling (Must respect agent occupancy & availability)
    if (effectivePreferredAgentId) {
      const preferredAgent = await prisma.agent.findUnique({
        where: { id: effectivePreferredAgentId },
        include: {
          executions: {
            where: {
              status: { in: ['RUNNING', 'QUEUED'] },
            },
          },
          taskResponsibilities: {
            include: {
              task: true,
            },
          },
        },
      });

      if (!preferredAgent || preferredAgent.projectId !== projectId) {
        return {
          assigned: false,
          taskId,
          reason: 'PREFERRED_AGENT_UNAUTHORIZED',
        };
      }

      const isOccupied =
        preferredAgent.executions.length > 0 ||
        preferredAgent.taskResponsibilities.some(
          (resp) => resp.task && resp.task.status === 'IN_PROGRESS',
        );

      if (preferredAgent.status !== 'ONLINE' || isOccupied) {
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

    // 2. Capability Matching & Agent Eligibility Check
    const candidates = await prisma.agent.findMany({
      where: {
        projectId,
        status: 'ONLINE',
      },
      include: {
        capabilities: true,
        executions: {
          where: {
            status: { in: ['RUNNING', 'QUEUED'] },
          },
        },
        taskResponsibilities: {
          include: {
            task: true,
          },
        },
      },
    });

    // Exclude occupied agents (running/queued executions or active IN_PROGRESS tasks)
    const eligibleAgents = candidates.filter((agent) => {
      if (agent.status !== 'ONLINE') return false;
      if (agent.executions.length > 0) return false;
      const hasActiveTask = agent.taskResponsibilities.some(
        (resp) => resp.task && resp.task.status === 'IN_PROGRESS',
      );
      if (hasActiveTask) return false;
      return true;
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
      const { score, matchedCapabilities, unmatchedCapabilities, categoryScores } =
        this.scoreCapabilities(agentCapStrings, task.requiredCapabilities);

      return {
        agent,
        score,
        matchedCapabilities,
        unmatchedCapabilities,
        categoryScores,
      };
    });

    // Deterministic Tie Breaking: score DESC -> createdAt ASC -> agent.id ASC
    scoredCandidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
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
      categoryScores: winner.categoryScores,
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
        // Target-task specific row lock (preserves concurrent non-conflicting task assignment)
        await tx.$executeRaw`SELECT * FROM tasks WHERE id = ${taskId} AND "projectId" = ${projectId} FOR UPDATE`;

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
