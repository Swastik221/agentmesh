import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../errors/app-error.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { AgentMeshMessageType } from '@agentmesh/agent-protocol';

export interface CreateArtifactInput {
  type: string;
  name: string;
  payload: unknown;
  executionId?: string;
  agentId?: string;
}

export interface ListArtifactsQuery {
  page?: number;
  limit?: number;
  type?: string;
}

export class ArtifactService {
  private async verifyProjectMembership(projectId: string, userId: string): Promise<void> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
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
      throw new ForbiddenError('User is not a member of this project');
    }
  }

  async createArtifact(
    projectId: string,
    taskId: string,
    userId: string,
    data: CreateArtifactInput,
  ) {
    await this.verifyProjectMembership(projectId, userId);

    if (!data.type || !data.type.trim()) {
      throw new BadRequestError('Artifact type is required');
    }

    if (!data.name || !data.name.trim()) {
      throw new BadRequestError('Artifact name is required');
    }

    if (data.payload === undefined || data.payload === null) {
      throw new BadRequestError('Artifact payload is required');
    }

    // Payload size validation
    const payloadString = JSON.stringify(data.payload);
    const payloadBytes = Buffer.byteLength(payloadString, 'utf8');
    if (payloadBytes > config.maxArtifactPayloadBytes) {
      throw new BadRequestError(
        `Artifact payload size (${payloadBytes} bytes) exceeds limit of ${config.maxArtifactPayloadBytes} bytes`,
      );
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        responsibilities: true,
      },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    // Determine producer agent
    let producerAgentId = data.agentId;

    if (producerAgentId) {
      const agent = await prisma.agent.findUnique({
        where: { id: producerAgentId },
      });
      if (!agent || agent.projectId !== projectId) {
        throw new ForbiddenError('Agent does not belong to this project');
      }
    } else if (data.executionId) {
      const execution = await prisma.taskExecution.findUnique({
        where: { id: data.executionId },
      });
      if (execution && execution.taskId === taskId) {
        producerAgentId = execution.agentId;
      }
    } else if (task.responsibilities.length > 0) {
      producerAgentId = task.responsibilities[0].agentId;
    }

    if (!producerAgentId) {
      throw new BadRequestError('Producer agent ID is required for artifact creation');
    }

    // Execute atomic transaction for versioning
    const artifact = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT * FROM tasks WHERE id = ${taskId} AND "projectId" = ${projectId} FOR UPDATE`;

      const existingArtifact = await tx.artifact.findFirst({
        where: {
          taskId,
          name: data.name,
        },
        orderBy: { version: 'desc' },
      });

      const version = existingArtifact ? existingArtifact.version + 1 : 1;

      return await tx.artifact.create({
        data: {
          projectId,
          taskId,
          executionId: data.executionId || null,
          agentId: producerAgentId!,
          ownerUserId: userId,
          type: data.type.trim(),
          name: data.name.trim(),
          version,
          payload: data.payload as Prisma.InputJsonValue,
        },
      });
    });

    // Post-commit real-time broadcast
    connectionManager.broadcastToProject(projectId, {
      type: AgentMeshMessageType.ARTIFACT_CREATED,
      payload: {
        artifactId: artifact.id,
        projectId,
        taskId,
        executionId: artifact.executionId || undefined,
        agentId: artifact.agentId,
        type: artifact.type,
        name: artifact.name,
        version: artifact.version,
      },
    });

    // Notify dependent tasks waiting on artifact
    const dependentDeps = await prisma.taskDependency.findMany({
      where: {
        artifactId: artifact.id,
      },
    });

    for (const dep of dependentDeps) {
      connectionManager.broadcastToProject(projectId, {
        type: AgentMeshMessageType.ARTIFACT_AVAILABLE,
        payload: {
          artifactId: artifact.id,
          projectId,
          taskId,
          consumerTaskId: dep.taskId,
        },
      });

      connectionManager.broadcastToProject(projectId, {
        type: AgentMeshMessageType.DEPENDENCY_AVAILABLE,
        payload: {
          dependencyId: dep.id,
          projectId,
          taskId: dep.taskId,
          artifactId: artifact.id,
          available: true,
        },
      });
    }

    return artifact;
  }

  async getArtifact(projectId: string, artifactId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            provider: true,
          },
        },
        ownerUser: {
          select: {
            id: true,
            displayName: true,
            walletAddress: true,
          },
        },
        task: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
    });

    if (!artifact || artifact.projectId !== projectId) {
      throw new NotFoundError('Artifact not found');
    }

    return artifact;
  }

  async listArtifacts(
    projectId: string,
    taskId: string,
    userId: string,
    query: ListArtifactsQuery,
  ) {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const where: Prisma.ArtifactWhereInput = {
      projectId,
      taskId,
    };

    if (query.type) {
      where.type = query.type;
    }

    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, config.maxArtifactsPerPage);
    const skip = (page - 1) * limit;

    const [artifacts, total] = await prisma.$transaction([
      prisma.artifact.findMany({
        where,
        orderBy: [{ name: 'asc' }, { version: 'desc' }],
        skip,
        take: limit,
        include: {
          agent: {
            select: {
              id: true,
              name: true,
              provider: true,
            },
          },
        },
      }),
      prisma.artifact.count({ where }),
    ]);

    return {
      items: artifacts,
      page,
      limit,
      total,
    };
  }
}

export const artifactService = new ArtifactService();
