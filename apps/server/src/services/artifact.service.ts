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
import { deltaSequencerService } from './delta-sequencer.service.js';
import { activityService } from './activity.service.js';

import crypto from 'node:crypto';

export interface CreateArtifactInput {
  type: string;
  name: string;
  payload: unknown;
  executionId?: string;
  agentId?: string;
  requiresReview?: boolean;
}

export interface ListArtifactsQuery {
  page?: number;
  limit?: number;
  type?: string;
}

export function canonicalJsonStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map((item) => canonicalJsonStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(val as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJsonStringify((val as Record<string, unknown>)[k])}`,
  );
  return '{' + pairs.join(',') + '}';
}

export function validateAndSerializeJsonPayload(payload: unknown): {
  payloadString: string;
  payloadBytes: number;
  contentHash: string;
  normalizedPayload: unknown;
} {
  if (payload === undefined || payload === null) {
    throw new BadRequestError('Artifact payload is required');
  }

  if (
    typeof payload === 'function' ||
    typeof payload === 'symbol' ||
    typeof payload === 'bigint'
  ) {
    throw new BadRequestError('Invalid artifact payload: unsupported JSON data type');
  }

  let payloadString: string;
  let normalizedPayload: unknown;
  try {
    const stringified = JSON.stringify(payload);
    if (stringified === undefined) {
      throw new BadRequestError('Invalid artifact payload: cannot be stringified to JSON');
    }
    normalizedPayload = JSON.parse(stringified);
    payloadString = canonicalJsonStringify(normalizedPayload);
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError('Invalid artifact payload: JSON serialization failed or circular reference detected');
  }

  const payloadBytes = Buffer.byteLength(payloadString, 'utf8');
  if (payloadBytes > config.maxArtifactPayloadBytes) {
    throw new BadRequestError(
      `Artifact payload size (${payloadBytes} bytes) exceeds limit of ${config.maxArtifactPayloadBytes} bytes`,
    );
  }

  const contentHash = crypto
    .createHash('sha256')
    .update(payloadString, 'utf8')
    .digest('hex');

  return { payloadString, payloadBytes, contentHash, normalizedPayload };
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

    // Payload validation, UTF-8 size check, SHA-256 contentHash calculation
    const { contentHash, normalizedPayload } = validateAndSerializeJsonPayload(data.payload);

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

    // Execute atomic transaction for versioning with retry handling for concurrency
    let attempts = 0;
    const maxRetries = 10;
    let artifact;

    while (attempts < maxRetries) {
      attempts++;
      try {
        artifact = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT * FROM tasks WHERE id = ${taskId} AND "projectId" = ${projectId} FOR UPDATE`;

          const existingArtifact = await tx.artifact.findFirst({
            where: {
              taskId,
              name: data.name.trim(),
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
              payload: normalizedPayload as Prisma.InputJsonValue,
              requiresReview: data.requiresReview ?? false,
            },
          });
        });
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          attempts < maxRetries
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!artifact) {
      throw new BadRequestError('Failed to create artifact due to high concurrency. Please retry.');
    }

    // Attach calculated contentHash for return
    const artifactWithHash = {
      ...artifact,
      contentHash,
    };

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

    await deltaSequencerService.recordAndBroadcastDelta(projectId, [
      {
        entity: 'artifact',
        entityId: artifact.id,
        operation: 'created',
        fields: {
          name: artifact.name,
          type: artifact.type,
          version: artifact.version,
          taskId: artifact.taskId,
          agentId: artifact.agentId,
        },
      },
    ]);

    // Link any task dependencies waiting for an artifact from this producer task
    const pendingDeps = await prisma.taskDependency.findMany({
      where: {
        dependsOnTaskId: artifact.taskId,
        dependencyType: {
          startsWith: 'ARTIFACT_REQUIRED',
        },
        artifactId: null,
      },
    });

    const totalProducerArtifacts = await prisma.artifact.count({
      where: { taskId: artifact.taskId },
    });

    for (const dep of pendingDeps) {
      let isMatch = false;

      if (dep.dependencyType === 'ARTIFACT_REQUIRED') {
        if (totalProducerArtifacts === 1) {
          isMatch = true;
        }
      } else if (dep.dependencyType.startsWith('ARTIFACT_REQUIRED:')) {
        const spec = dep.dependencyType.slice('ARTIFACT_REQUIRED:'.length).trim();
        if (spec.startsWith('name:')) {
          const targetName = spec.slice('name:'.length).trim();
          isMatch = artifact.name === targetName;
        } else if (spec.startsWith('type:')) {
          const targetType = spec.slice('type:'.length).trim();
          isMatch = artifact.type === targetType;
        } else if (spec.includes(':')) {
          const [targetType, targetName] = spec.split(':').map((s) => s.trim());
          isMatch = artifact.type === targetType && artifact.name === targetName;
        } else {
          isMatch = artifact.name === spec || artifact.type === spec;
        }
      }

      if (isMatch) {
        await prisma.taskDependency.update({
          where: { id: dep.id },
          data: { artifactId: artifact.id },
        });
      }
    }

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

    await activityService.recordActivity(projectId, {
      type: 'artifact.created',
      actorType: 'agent',
      actorId: artifact.agentId,
      taskId,
      artifactId: artifact.id,
      message: `${artifact.type} artifact '${artifact.name}' v${artifact.version} created`,
    });

    return artifactWithHash;
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

    const payloadString = canonicalJsonStringify(artifact.payload);
    const contentHash = crypto
      .createHash('sha256')
      .update(payloadString, 'utf8')
      .digest('hex');

    return {
      ...artifact,
      contentHash,
    };
  }

  async reviewArtifact(
    projectId: string,
    artifactId: string,
    reviewerUserId: string,
    decision: { approved: boolean; note?: string },
  ) {
    await this.verifyProjectMembership(projectId, reviewerUserId);

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
      include: { task: true },
    });

    if (!artifact || artifact.projectId !== projectId) {
      throw new NotFoundError('Artifact not found');
    }

    if (!artifact.requiresReview) {
      throw new BadRequestError('Artifact does not require review');
    }

    if (artifact.status !== 'PENDING') {
      throw new BadRequestError('Artifact has already been reviewed');
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT * FROM artifacts WHERE id = ${artifactId} AND "projectId" = ${projectId} FOR UPDATE`;

      const fresh = await tx.artifact.findUnique({ where: { id: artifactId } });
      if (!fresh || fresh.projectId !== projectId) {
        throw new NotFoundError('Artifact not found');
      }
      if (fresh.status !== 'PENDING') {
        throw new BadRequestError('Artifact has already been reviewed');
      }

      const updatedArtifact = await tx.artifact.update({
        where: { id: artifactId },
        data: {
          status: decision.approved ? 'APPROVED' : 'REJECTED',
          reviewedById: reviewerUserId,
          reviewedAt: new Date(),
          reviewNote: decision.note ?? null,
        },
      });

      const targetStatus = decision.approved ? 'COMPLETED' : 'IN_PROGRESS';
      const updatedTask = await tx.task.update({
        where: { id: artifact.taskId },
        data: { status: targetStatus },
      });

      return { updatedArtifact, updatedTask };
    });

    connectionManager.broadcastToProject(projectId, {
      type: AgentMeshMessageType.TASK_STATUS,
      payload: {
        taskId: artifact.taskId,
        status: updated.updatedTask.status,
      },
    });

    await deltaSequencerService.recordAndBroadcastDelta(projectId, [
      {
        entity: 'artifact',
        entityId: artifactId,
        operation: 'updated',
        fields: { status: updated.updatedArtifact.status },
      },
      {
        entity: 'task',
        entityId: artifact.taskId,
        operation: 'updated',
        fields: { status: updated.updatedTask.status },
      },
    ]);

    await activityService.recordActivity(projectId, {
      type: decision.approved ? 'artifact.approved' : 'artifact.rejected',
      actorType: 'human',
      actorId: reviewerUserId,
      taskId: artifact.taskId,
      artifactId: artifact.id,
      message: decision.approved
        ? `Artifact '${artifact.name}' approved — task completed`
        : `Artifact '${artifact.name}' rejected — task reopened`,
    });

    return {
      artifact: updated.updatedArtifact,
      task: updated.updatedTask,
    };
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
