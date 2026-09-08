import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { AgentMeshMessageType } from '@agentmesh/agent-protocol';
import { deltaSequencerService } from './delta-sequencer.service.js';
import type { WebSocketMessage } from '../websocket/websocket.types.js';
import { BadRequestError } from '../errors/app-error.js';

export type ActivityActorType = 'human' | 'agent' | 'system' | 'coordinator';

export interface RecordActivityInput {
  type: string;
  actorType: ActivityActorType;
  actorId: string;
  actorName?: string;
  taskId?: string;
  artifactId?: string;
  message?: string;
  payload?: Record<string, unknown>;
}

/**
 * Persists workspace activity events and broadcasts them live to connected
 * clients over the existing WebSocket + delta infrastructure. This is the
 * canonical activity feed backing the UI, not a separate realtime system.
 */
export class ActivityService {
  async recordActivity(projectId: string, input: RecordActivityInput): Promise<void> {
    const activity = await prisma.activityEvent.create({
      data: {
        projectId,
        type: input.type,
        actorType: input.actorType,
        actorId: input.actorId,
        actorName: input.actorName ?? null,
        taskId: input.taskId ?? null,
        artifactId: input.artifactId ?? null,
        payload:
          input.payload !== undefined
            ? (input.payload as Prisma.InputJsonValue)
            : undefined,
      },
    });

    connectionManager.broadcastToProject(projectId, {
      type: AgentMeshMessageType.ACTIVITY_CREATED,
      payload: {
        activityId: activity.id,
        projectId,
        type: activity.type,
        actorType: activity.actorType as ActivityActorType,
        actorId: activity.actorId,
        actorName: activity.actorName ?? undefined,
        taskId: activity.taskId ?? undefined,
        artifactId: activity.artifactId ?? undefined,
        message: input.message,
        createdAt: activity.createdAt.toISOString(),
      },
    } as unknown as WebSocketMessage);

    try {
      await deltaSequencerService.recordAndBroadcastDelta(projectId, [
        {
          entity: 'activity',
          entityId: activity.id,
          operation: 'created',
          fields: {
            type: activity.type,
            actorId: activity.actorId,
            taskId: activity.taskId ?? undefined,
            artifactId: activity.artifactId ?? undefined,
          },
        },
      ]);
    } catch (err) {
      // The activity row is already persisted; a failed delta (e.g. project
      // torn down mid-teardown) must not surface as an unhandled rejection.
      if (err instanceof BadRequestError) {
        return;
      }
      throw err;
    }
  }

  async listActivity(
    projectId: string,
    _userId: string,
    options: { limit?: number } = {},
  ): Promise<
    Array<{
      id: string;
      projectId: string;
      type: string;
      actorType: string;
      actorId: string;
      actorName: string | null;
      taskId: string | null;
      artifactId: string | null;
      createdAt: Date;
    }>
  > {
    return prisma.activityEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(options.limit ?? 50, 200),
    });
  }
}

export const activityService = new ActivityService();