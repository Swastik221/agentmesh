import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { ConnectionMetadata, WebSocketMessage } from '../websocket/websocket.types.js';
import {
  WorkspaceDeltaChange,
  WorkspaceDeltaMessage,
  createWorkspaceDeltaMessage,
  createWorkspaceResyncRequiredMessage,
} from '@agentmesh/agent-protocol';
import { BadRequestError } from '../errors/app-error.js';

export class DeltaSequencerService {
  private replayBuffers: Map<string, WorkspaceDeltaMessage[]> = new Map();
  private readonly MAX_REPLAY_BUFFER_SIZE = 50;

  /**
   * Atomically increments and returns the next workspace sequence integer using PostgreSQL FOR UPDATE semantics.
   */
  async allocateNextSequence(projectId: string): Promise<number> {
    const result = await prisma.$queryRaw<{ lastSequence: number }[]>`
      UPDATE projects
      SET "lastSequence" = "lastSequence" + 1
      WHERE id = ${projectId}
      RETURNING "lastSequence"
    `;

    if (!result || result.length === 0) {
      throw new BadRequestError(`Project with ID '${projectId}' not found`);
    }

    return result[0].lastSequence;
  }

  /**
   * Retrieves current workspace sequence for consistent snapshot generation.
   */
  async getCurrentSequence(projectId: string): Promise<number> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { lastSequence: true },
    });
    return project?.lastSequence ?? 0;
  }

  /**
   * Generates, records, and broadcasts a workspace delta message post-commit.
   */
  async recordAndBroadcastDelta(
    projectId: string,
    changes: WorkspaceDeltaChange[],
  ): Promise<WorkspaceDeltaMessage> {
    if (!changes || changes.length === 0) {
      throw new BadRequestError('Delta must contain at least one state change');
    }

    // 1. Construct candidate delta message for size validation BEFORE consuming a sequence number
    const candidateDeltaMsg = createWorkspaceDeltaMessage(
      {
        projectId,
        senderId: 'server',
      },
      {
        sequence: 0,
        changes,
      },
    );

    const serializedCandidate = JSON.stringify(candidateDeltaMsg);
    const candidateBytes = Buffer.byteLength(serializedCandidate, 'utf8');

    if (candidateBytes > config.maxWorkspaceDeltaBytes) {
      throw new BadRequestError(
        `Delta payload size (${candidateBytes} bytes) exceeds limit of ${config.maxWorkspaceDeltaBytes} bytes`,
      );
    }

    // 2. Allocate sequence atomically (errors propagate naturally without swallowing)
    const sequence = await this.allocateNextSequence(projectId);

    // 3. Construct final workspace.delta message with allocated sequence
    const deltaMsg = createWorkspaceDeltaMessage(
      {
        projectId,
        senderId: 'server',
      },
      {
        sequence,
        changes,
      },
    );

    // Buffer delta in workspace replay buffer
    let buffer = this.replayBuffers.get(projectId);
    if (!buffer) {
      buffer = [];
      this.replayBuffers.set(projectId, buffer);
    }
    buffer.push(deltaMsg);

    if (buffer.length > this.MAX_REPLAY_BUFFER_SIZE) {
      buffer.shift();
    }

    // Post-commit broadcast to authorized project user connections
    connectionManager.broadcastToProjectUsers(projectId, deltaMsg as unknown as WebSocketMessage);

    return deltaMsg;
  }

  /**
   * Handles inbound client workspace.resync.request.
   * Either replays missing buffered deltas or emits workspace.resync.required and triggers fresh snapshot.
   */
  async processResyncRequest(
    metadata: ConnectionMetadata,
    lastKnownSequence: number,
    reason: string,
    sendSnapshotFn: (metadata: ConnectionMetadata) => Promise<void>,
  ): Promise<void> {
    const { projectId } = metadata;
    const currentSeq = await this.getCurrentSequence(projectId);

    if (lastKnownSequence === currentSeq) {
      return;
    }

    const buffer = this.replayBuffers.get(projectId) || [];

    // Check if missing deltas exist in buffer and are strictly contiguous
    const availableDeltas = buffer.filter((d) => d.payload.sequence > lastKnownSequence);

    let isContiguous =
      availableDeltas.length > 0 &&
      availableDeltas[0].payload.sequence === lastKnownSequence + 1 &&
      availableDeltas[availableDeltas.length - 1].payload.sequence === currentSeq;

    if (isContiguous) {
      for (let i = 0; i < availableDeltas.length; i++) {
        if (availableDeltas[i].payload.sequence !== lastKnownSequence + 1 + i) {
          isContiguous = false;
          break;
        }
      }
    }

    if (isContiguous) {
      // Replay missed deltas
      for (const delta of availableDeltas) {
        if (metadata.socket.readyState === metadata.socket.OPEN) {
          metadata.socket.send(JSON.stringify(delta));
        }
      }
      return;
    }

    // Buffer replay insufficient: notify resync required and send fresh snapshot
    const resyncReqMsg = createWorkspaceResyncRequiredMessage(
      {
        projectId,
        senderId: 'server',
        ...(metadata.userId && { recipientId: metadata.userId }),
      },
      {
        sequence: currentSeq,
        reason: `Replay unavailable for sequence ${lastKnownSequence} (${reason}); fresh snapshot issued.`,
      },
    );

    if (metadata.socket.readyState === metadata.socket.OPEN) {
      metadata.socket.send(JSON.stringify(resyncReqMsg));
    }

    await sendSnapshotFn(metadata);
  }

  clearReplayBuffer(projectId?: string): void {
    if (projectId) {
      this.replayBuffers.delete(projectId);
    } else {
      this.replayBuffers.clear();
    }
  }
}

export const deltaSequencerService = new DeltaSequencerService();
