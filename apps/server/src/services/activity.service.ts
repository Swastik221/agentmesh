import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { AgentMeshMessageType, PROTOCOL_VERSION } from '@agentmesh/agent-protocol';
import { deltaSequencerService } from './delta-sequencer.service.js';
import type { WebSocketMessage } from '../websocket/websocket.types.js';
import { BadRequestError } from '../errors/app-error.js';
import { getProjectRole } from '../auth/project-access.js';

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
    // `message` has no dedicated column on ActivityEvent; fold it into the
    // JSON payload so it is actually persisted and queryable, rather than
    // existing only for the instant of the live broadcast below. Every
    // existing call site either passes no payload or a small object with
    // unrelated keys, so merging is additive and does not overwrite anything.
    const persistedPayload =
      input.message !== undefined || input.payload !== undefined
        ? { ...(input.payload ?? {}), ...(input.message !== undefined && { message: input.message }) }
        : undefined;

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
          persistedPayload !== undefined
            ? (persistedPayload as Prisma.InputJsonValue)
            : undefined,
      },
    });

    // A complete protocol envelope. This previously sent only { type, payload },
    // which does not satisfy activityCreatedMessageSchema (it extends
    // baseEnvelopeSchema: id, protocolVersion, projectId, senderId, timestamp
    // are all required), so any strict consumer that validates before handling
    // silently dropped every activity event. Browsers never noticed because
    // they ignore this message type; a connected CLI agent does not.
    connectionManager.broadcastToProject(projectId, {
      id: crypto.randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
      projectId,
      senderId: 'server',
      timestamp: activity.createdAt.toISOString(),
      kind: 'event',
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
            actorName: activity.actorName ?? undefined,
            // Included so a live listener (e.g. an agent's terminal log on the
            // canvas) can render the line the instant it arrives, without a
            // round trip back to GET /projects/:id/activity for the text.
            message: input.message,
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
    userId: string,
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
    // Activity includes payment and approval payloads: members only.
    await getProjectRole(projectId, userId);
    return prisma.activityEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(options.limit ?? 50, 200),
    });
  }
}

export const activityService = new ActivityService();