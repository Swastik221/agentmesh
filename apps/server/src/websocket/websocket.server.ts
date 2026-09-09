import type { Server as HTTPServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import {
  AgentMeshMessageType,
  createWorkspaceSnapshotMessage,
  createWorkspacePresenceChangedMessage,
} from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { connectionManager } from './connection.manager.js';
import { ConnectionMetadata, WebSocketMessage, WSMessageType } from './websocket.types.js';
import { handshakeService, HandshakeErrorCode } from '../handshake/index.js';
import { messagingService } from '../messaging/index.js';
import { sessionService } from '../auth/session.service.js';
import { deltaSequencerService } from '../services/delta-sequencer.service.js';

function extractSessionIdFromReq(req: IncomingMessage): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith('agentmesh_session=')) {
        return cookie.substring('agentmesh_session='.length);
      }
    }
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.url) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const token = parsedUrl.searchParams.get('token');
      if (token && token.trim() !== '') {
        return token.trim();
      }
    } catch {
      // Ignore URL parse errors on invalid URLs
    }
  }
  return undefined;
}

export class AgentMeshWebSocketServer {
  private wss: WebSocketServer;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(server: HTTPServer, heartbeatIntervalMs = 30000) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req: IncomingMessage, socket, head) => {
      this.handleUpgrade(req, socket as Duplex, head);
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage, projectId: string) => {
      this.handleConnection(ws, req, projectId);
    });

    this.startHeartbeat(heartbeatIntervalMs);
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    try {
      const reqUrl = req.url || '';
      const parsedUrl = new URL(reqUrl, 'http://localhost');

      if (parsedUrl.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const projectId = parsedUrl.searchParams.get('projectId');
      if (!projectId || projectId.trim() === '') {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      // Pre-Upgrade Session Authentication & Project Authorization (PRD-37 FIX 1)
      const httpSessionId = extractSessionIdFromReq(req);
      if (!httpSessionId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      let session;
      try {
        session = await sessionService.validateSession(httpSessionId);
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Check project authorization (owner or member) based strictly on authenticated session user id
      const isOwner = project.ownerId === session.user.id;
      let isMember = isOwner;
      if (!isMember) {
        const membership = await prisma.projectMember.findUnique({
          where: {
            projectId_userId: {
              projectId,
              userId: session.user.id,
            },
          },
        });
        isMember = Boolean(membership);
      }

      if (!isMember) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req, projectId);
      });
    } catch (error) {
      logger.error('[WebSocket] Upgrade error:', error);
      if (!socket.destroyed) {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    }
  }

  private async handleConnection(
    ws: WebSocket,
    req: IncomingMessage,
    projectId: string,
  ): Promise<void> {
    const httpSessionId = extractSessionIdFromReq(req);
    const metadata = connectionManager.addConnection(projectId, ws, httpSessionId);
    logger.info(
      `[WebSocket] Connection ${metadata.connectionId} established for project ${projectId}`,
    );

    ws.on('pong', () => {
      metadata.isAlive = true;
      metadata.lastHeartbeat = Date.now();
    });

    ws.on('message', (data: RawData) => {
      // Fire-and-forget async boundary: never allow message handling to leak an
      // unhandled rejection (e.g. delta recording racing workspace teardown).
      this.handleIncomingMessage(metadata, data).catch((err: unknown) => {
        logger.error(`[WebSocket] Error handling message on ${metadata.connectionId}:`, err);
      });
    });

    ws.on('close', async () => {
      try {
        logger.info(
          `[WebSocket] Connection ${metadata.connectionId} closed for project ${projectId}`,
        );
        const isUser = Boolean(metadata.userId);
        const userId = metadata.userId;
        const isAgent = Boolean(metadata.agentId);
        const agentId = metadata.agentId;

        if (isAgent) {
          await handshakeService.handleDisconnection(metadata);
          connectionManager.removeConnection(metadata.connectionId);
          if (agentId && connectionManager.getActiveAgentConnectionsCount(agentId) === 0) {
            const presenceMsg = createWorkspacePresenceChangedMessage(
              {
                projectId,
                senderId: 'server',
              },
              {
                entityType: 'agent',
                entityId: agentId,
                status: 'OFFLINE',
              },
            );
            connectionManager.broadcastToProjectUsers(
              projectId,
              presenceMsg as unknown as WebSocketMessage,
            );
            await deltaSequencerService.recordAndBroadcastDelta(projectId, [
              {
                entity: 'presence',
                entityId: agentId,
                operation: 'updated',
                fields: { entityType: 'agent', status: 'OFFLINE' },
              },
            ]);
          }
        } else {
          connectionManager.removeConnection(metadata.connectionId);
        }

        if (isUser && userId) {
          if (connectionManager.getActiveUserConnectionsCount(projectId, userId) === 0) {
            const presenceMsg = createWorkspacePresenceChangedMessage(
              {
                projectId,
                senderId: 'server',
              },
              {
                entityType: 'user',
                entityId: userId,
                status: 'OFFLINE',
              },
            );
            connectionManager.broadcastToProjectUsers(
              projectId,
              presenceMsg as unknown as WebSocketMessage,
            );
            // Best-effort presence delta during close cleanup: the workspace may
            // already be torn down (e.g. test teardown), so a failure here must not
            // become an unhandled rejection that fails unrelated work.
            await deltaSequencerService.recordAndBroadcastDelta(projectId, [
              {
                entity: 'presence',
                entityId: userId,
                operation: 'updated',
                fields: { entityType: 'user', status: 'OFFLINE' },
              },
            ]);
          }
        }

        try {
          if (agentId) {
            const { activityService } = await import('../services/activity.service.js');
            await activityService.recordActivity(projectId, {
              type: 'agent.disconnected',
              actorType: 'agent',
              actorId: agentId,
              message: 'Agent disconnected',
              payload: { connectionId: metadata.connectionId },
            });
          }
        } catch {
          // Best-effort activity during teardown.
        }
      } catch (err) {
        logger.error(
          `[WebSocket] Error during close cleanup for connection ${metadata.connectionId}:`,
          err,
        );
      }
    });

    ws.on('error', (err) => {
      logger.error(`[WebSocket] Error on connection ${metadata.connectionId}:`, err);
      connectionManager.removeConnection(metadata.connectionId);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    // Handle user session authentication & workspace authorization for User UI clients
    const parsedUrl = new URL(req.url || '', 'http://localhost');
    const tokenParam = parsedUrl.searchParams.get('token');
    const clientTypeParam = parsedUrl.searchParams.get('clientType');
    const isUserClient = Boolean((tokenParam && tokenParam.trim() !== '') || clientTypeParam === 'user');

    if (isUserClient) {
      if (!httpSessionId) {
        logger.warn(
          `[WebSocket] Unauthenticated user connection attempt to project ${projectId}`,
        );
        this.sendError(ws, 'UNAUTHORIZED', 'Authentication required. No session provided.');
        ws.close(4001, 'Unauthorized');
        connectionManager.removeConnection(metadata.connectionId);
        return;
      }

      let session;
      try {
        session = await sessionService.validateSession(httpSessionId);
      } catch (err) {
        logger.warn(
          `[WebSocket] Invalid or expired session for connection ${metadata.connectionId}:`,
          err,
        );
        this.sendError(ws, 'UNAUTHORIZED', 'Invalid or expired authentication session');
        ws.close(4001, 'Unauthorized');
        connectionManager.removeConnection(metadata.connectionId);
        return;
      }

      if (!session || !session.userId) {
        this.sendError(ws, 'UNAUTHORIZED', 'Invalid or expired authentication session');
        ws.close(4001, 'Unauthorized');
        connectionManager.removeConnection(metadata.connectionId);
        return;
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { members: true },
      });

      const isOwner = project?.ownerId === session.userId;
      const isMember = project?.members.some((m) => m.userId === session.userId);

      if (!isOwner && !isMember) {
        logger.warn(
          `[WebSocket] Access denied for user ${session.userId} to project ${projectId}`,
        );
        this.sendError(ws, 'FORBIDDEN', 'User is not a member of this workspace');
        ws.close(4003, 'Forbidden');
        connectionManager.removeConnection(metadata.connectionId);
        return;
      }

      metadata.userId = session.userId;
      metadata.authenticated = true;

      // Send bounded workspace snapshot
      if (project) {
        await this.sendWorkspaceSnapshot(metadata, project);
      }

      // Broadcast user ONLINE presence if this is user's first connection
      if (
        connectionManager.getActiveUserConnectionsCount(projectId, session.userId) === 1
      ) {
        const presenceMsg = createWorkspacePresenceChangedMessage(
          {
            projectId,
            senderId: 'server',
          },
          {
            entityType: 'user',
            entityId: session.userId,
            status: 'ONLINE',
            metadata: {
              displayName: session.user.displayName,
              walletAddress: session.user.walletAddress,
            },
          },
        );
        connectionManager.broadcastToProjectUsers(
          projectId,
          presenceMsg as unknown as WebSocketMessage,
          metadata.connectionId,
        );
        await deltaSequencerService.recordAndBroadcastDelta(projectId, [
          {
            entity: 'presence',
            entityId: session.userId,
            operation: 'updated',
            fields: { entityType: 'user', status: 'ONLINE' },
          },
        ]);
      }
    }
  }

  private async sendWorkspaceSnapshot(
    metadata: ConnectionMetadata,
    project: { id: string; name: string; ownerId: string },
  ): Promise<void> {
    const members = await prisma.projectMember.findMany({
      where: { projectId: metadata.projectId },
      include: { user: true },
    });

    const owner = await prisma.user.findUnique({
      where: { id: project.ownerId },
    });

    const memberList = members.map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      walletAddress: m.user.walletAddress,
      role: m.role,
      status: connectionManager.isUserConnected(metadata.projectId, m.userId)
        ? ('ONLINE' as const)
        : ('OFFLINE' as const),
    }));

    if (owner && !memberList.some((m) => m.userId === owner.id)) {
      memberList.unshift({
        userId: owner.id,
        displayName: owner.displayName,
        walletAddress: owner.walletAddress,
        role: 'OWNER',
        status: connectionManager.isUserConnected(metadata.projectId, owner.id)
          ? ('ONLINE' as const)
          : ('OFFLINE' as const),
      });
    }

    const agents = await prisma.agent.findMany({
      where: { projectId: metadata.projectId },
    });

    const agentList = agents.map((a) => {
      let status: 'ONLINE' | 'OFFLINE' | 'BUSY' = a.status === 'BUSY' ? 'BUSY' : 'OFFLINE';
      if (status !== 'BUSY') {
        status = connectionManager.isAgentConnected(metadata.projectId, a.id)
          ? 'ONLINE'
          : 'OFFLINE';
      }
      return {
        agentId: a.id,
        name: a.name,
        ownerId: a.ownerId,
        provider: a.provider,
        status,
      };
    });

    const tasks = await prisma.task.findMany({
      where: { projectId: metadata.projectId },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    const taskList = tasks.map((t) => ({
      taskId: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
    }));

    const currentSeq = await deltaSequencerService.getCurrentSequence(metadata.projectId);

    const snapshotMsg = createWorkspaceSnapshotMessage(
      {
        projectId: metadata.projectId,
        senderId: 'server',
        ...(metadata.userId && { recipientId: metadata.userId }),
      },
      {
        workspace: {
          id: project.id,
          name: project.name,
        },
        sequence: currentSeq,
        members: memberList,
        agents: agentList,
        tasks: taskList,
      },
    );

    this.sendJson(metadata.socket, snapshotMsg as unknown as WebSocketMessage);
  }

  private async handleIncomingMessage(
    metadata: ConnectionMetadata,
    rawData: RawData,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData.toString());
    } catch {
      this.sendError(metadata.socket, 'INVALID_MESSAGE', 'Invalid WebSocket message');
      return;
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).type !== 'string' ||
      !('payload' in parsed)
    ) {
      this.sendError(metadata.socket, 'INVALID_MESSAGE', 'Invalid WebSocket message');
      return;
    }

    const message = parsed as WebSocketMessage;
    metadata.lastHeartbeat = Date.now();
    metadata.isAlive = true;

    // Handle handshake request
    if (message.type === AgentMeshMessageType.AGENT_HANDSHAKE) {
      const handshakeResult = await handshakeService.processHandshake(metadata, parsed);
      this.sendJson(metadata.socket, handshakeResult.message as unknown as WebSocketMessage);

      if (handshakeResult.success && metadata.agentId) {
        const presenceMsg = createWorkspacePresenceChangedMessage(
          {
            projectId: metadata.projectId,
            senderId: 'server',
          },
          {
            entityType: 'agent',
            entityId: metadata.agentId,
            status: 'ONLINE',
          },
        );
        connectionManager.broadcastToProjectUsers(
          metadata.projectId,
          presenceMsg as unknown as WebSocketMessage,
        );
        await deltaSequencerService.recordAndBroadcastDelta(metadata.projectId, [
          {
            entity: 'presence',
            entityId: metadata.agentId,
            operation: 'updated',
            fields: { entityType: 'agent', status: 'ONLINE' },
          },
        ]);
        const { activityService } = await import('../services/activity.service.js');
        await activityService.recordActivity(metadata.projectId, {
          type: 'agent.connected',
          actorType: 'agent',
          actorId: metadata.agentId,
          message: 'Agent connected',
        });
      }
      return;
    }

    // Handle agent.message
    if (message.type === AgentMeshMessageType.AGENT_MESSAGE) {
      const result = await messagingService.processAgentMessage(metadata, parsed);
      if (!result.success && result.error) {
        this.sendJson(metadata.socket, result.error as unknown as WebSocketMessage);
      }
      return;
    }

    // Handle workspace.resync.request
    if (message.type === AgentMeshMessageType.WORKSPACE_RESYNC_REQUEST) {
      try {
        const payload = (message as { payload: { lastKnownSequence: number; reason: string } }).payload;
        await deltaSequencerService.processResyncRequest(
          metadata,
          payload.lastKnownSequence ?? 0,
          payload.reason || 'CLIENT_REQUEST',
          async (meta) => {
            const project = await prisma.project.findUnique({
              where: { id: meta.projectId },
              select: { id: true, name: true, ownerId: true },
            });
            if (project) {
              await this.sendWorkspaceSnapshot(meta, project);
            }
          },
        );
      } catch (err: unknown) {
        const error = err as Error;
        this.sendError(
          metadata.socket,
          'RESYNC_FAILED',
          error?.message || 'Failed to process workspace resync',
        );
      }
      return;
    }

    // Handle inbound artifact.created from connected BYOA agent
    if (message.type === AgentMeshMessageType.ARTIFACT_CREATED) {
      if (!metadata.authenticated || !metadata.agentId) {
        this.sendError(metadata.socket, 'UNAUTHORIZED', 'Agent must be authenticated to publish artifacts');
        return;
      }

      try {
        const payload = (message as { payload: Record<string, unknown> }).payload;
        const taskId = payload.taskId as string;
        const type = payload.type as string;
        const name = payload.name as string;
        const artifactPayload = payload.payload;
        const executionId = payload.executionId as string | undefined;

        const agent = await prisma.agent.findUnique({
          where: { id: metadata.agentId },
        });

        if (!agent) {
          this.sendError(metadata.socket, 'AGENT_NOT_FOUND', 'Agent not found');
          return;
        }

        const { artifactService } = await import('../services/artifact.service.js');
        const artifact = await artifactService.createArtifact(
          metadata.projectId,
          taskId,
          agent.ownerId,
          {
            type,
            name,
            payload: artifactPayload,
            executionId,
            agentId: metadata.agentId,
            requiresReview: true,
          },
        );

        // Agent-published artifacts enter the human review gate.
        const { taskService } = await import('../tasks/task.service.js');
        await taskService.markPendingApproval(metadata.projectId, taskId, metadata.agentId);

        this.sendJson(metadata.socket, {
          type: AgentMeshMessageType.ARTIFACT_CREATED,
          payload: {
            artifactId: artifact.id,
            projectId: metadata.projectId,
            taskId: artifact.taskId,
            executionId: artifact.executionId || undefined,
            agentId: artifact.agentId,
            type: artifact.type,
            name: artifact.name,
            version: artifact.version,
          },
        } as unknown as WebSocketMessage);
      } catch (err: unknown) {
        const error = err as Error;
        this.sendError(
          metadata.socket,
          'ARTIFACT_CREATION_FAILED',
          error?.message || 'Failed to create artifact',
        );
      }
      return;
    }

    // Handle connector task messages
    if (
      message.type === AgentMeshMessageType.TASK_ACCEPTED ||
      message.type === AgentMeshMessageType.TASK_COMPLETED ||
      message.type === AgentMeshMessageType.TASK_FAILED ||
      message.type === AgentMeshMessageType.TASK_REJECTED ||
      message.type === AgentMeshMessageType.TASK_PROGRESS ||
      message.type === AgentMeshMessageType.TASK_STATUS
    ) {
      const { connectorService } = await import('../connector/connector.service.js');
      const result = await connectorService.processConnectorTaskMessage(metadata, parsed);
      if (!result.success && result.error) {
        this.sendJson(metadata.socket, result.error as unknown as WebSocketMessage);
      }
      return;
    }

    // Ping / Pong handlers
    if (message.type === WSMessageType.PING) {
      this.sendJson(metadata.socket, {
        type: WSMessageType.PONG,
        payload: {},
      });
      return;
    }

    if (message.type === WSMessageType.PONG) {
      return;
    }

    // Pre-handshake blocking for application messages
    if (!metadata.authenticated) {
      const rejection = handshakeService.createRejection(
        metadata,
        HandshakeErrorCode.HANDSHAKE_REQUIRED,
        'Handshake required before sending application messages',
        (parsed as { id?: string }).id,
      );
      this.sendJson(metadata.socket, rejection as unknown as WebSocketMessage);
      return;
    }
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    if (socket.readyState === WebSocket.OPEN) {
      this.sendJson(socket, {
        type: WSMessageType.ERROR,
        payload: {
          code,
          message,
        },
      });
    }
  }

  private sendJson(socket: WebSocket, data: WebSocketMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }

  public startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const connections = connectionManager.getAllConnections();
      for (const conn of connections) {
        if (!conn.isAlive) {
          logger.info(`[WebSocket] Terminating stale connection ${conn.connectionId}`);
          conn.socket.terminate();
          connectionManager.removeConnection(conn.connectionId);
        } else {
          conn.isAlive = false;
          if (conn.socket.readyState === WebSocket.OPEN) {
            conn.socket.ping();
          }
        }
      }
    }, intervalMs);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public close(): void {
    this.stopHeartbeat();
    connectionManager.clear();
    this.wss.close();
  }
}

export const setupWebSocketServer = (
  server: HTTPServer,
  heartbeatIntervalMs = 30000,
): AgentMeshWebSocketServer => {
  return new AgentMeshWebSocketServer(server, heartbeatIntervalMs);
};
