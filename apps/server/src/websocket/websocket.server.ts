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
import { agentConnectTokenService } from '../services/agent-connect-token.service.js';
import { TaskPriority } from '@prisma/client';

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

/**
 * Reads an agent connect token, if one was presented. Deliberately a different
 * header and query name from the session so the two credentials can never be
 * confused for one another.
 */
/**
 * Wire type for a free-text line an agent process posts to its own workspace.
 * Deliberately outside the versioned agent-protocol package: not part of the
 * inter-agent or task-lifecycle contract, just a live terminal-style log line
 * a connected CLI agent can post, mirrored into the real activity/delta
 * pipeline below.
 */
const AGENT_LOG_TYPE = 'agent.log';
const AGENT_LOG_ACTIVITY_TYPE = 'agent.log';
const AGENT_LOG_MAX_LENGTH = 2000;
/**
 * An agent's own terminal posting a real, actionable line: unlike agent.log
 * (display only), this creates a real Task in the agent's project, assigns
 * it directly to that same agent (the agent asked for this work itself, so
 * capability matching does not apply), and executes it through the exact
 * same real pipeline the workspace UI's "New task" -> "Assign" -> "Start
 * execution" buttons already use. No new execution logic: taskService,
 * then a direct responsibility assignment, then executionService.
 */
const AGENT_PROMPT_TYPE = 'agent.prompt';
/**
 * Roster of the other agents in this project, pushed to connected agents so a
 * CLI knows who its teammates are: who is online, and the id to address when
 * sending a direct agent.message. Agents otherwise see nothing about each
 * other, since workspace deltas go only to browser clients.
 */
const AGENT_ROSTER_TYPE = 'agent.roster';
const AGENT_PROMPT_MAX_TITLE_LENGTH = 120;
const AGENT_PROMPT_MAX_BODY_LENGTH = 4000;

function extractConnectTokenFromReq(req: IncomingMessage): string | undefined {
  const header = req.headers['x-agent-connect-token'];
  if (typeof header === 'string' && header.trim() !== '') {
    return header.trim();
  }
  if (req.url) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const qp = parsedUrl.searchParams.get('connectToken');
      if (qp && qp.trim() !== '') {
        return qp.trim();
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

      // An agent process authenticates with its own scoped connect token rather
      // than the browser's SIWE session. Checked before the session path and
      // kept entirely separate from it: a connect token authorises one agent in
      // one project and nothing else, and the session path below is unchanged.
      const connectToken = extractConnectTokenFromReq(req);
      if (connectToken) {
        try {
          const resolved = await agentConnectTokenService.resolve(connectToken);
          if (resolved.projectId !== projectId) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }
          this.wss.handleUpgrade(req, socket, head, (ws) => {
            this.wss.emit('connection', ws, req, projectId);
          });
          return;
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
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

    const presentedConnectToken = extractConnectTokenFromReq(req);
    if (presentedConnectToken) {
      try {
        const resolved = await agentConnectTokenService.resolve(presentedConnectToken);
        if (resolved.projectId === projectId) {
          metadata.connectToken = resolved;
        }
      } catch {
        // Already rejected at upgrade time; a token that expires in between
        // simply leaves the connection unauthenticated and the handshake fails.
      }
    }
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
            ]).catch(() => {});
          }
        }

        try {
          if (agentId) {
            const { activityService } = await import('../services/activity.service.js');
            const goneAgent = await prisma.agent.findUnique({
              where: { id: agentId },
              select: { name: true },
            });
            await activityService.recordActivity(projectId, {
              type: 'agent.disconnected',
              actorType: 'agent',
              actorId: agentId,
              actorName: goneAgent?.name,
              message: `${goneAgent?.name ?? 'An agent'} disconnected`,
              payload: { connectionId: metadata.connectionId },
            });
            await this.broadcastAgentRoster(projectId);
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
        const connectedAgent = await prisma.agent.findUnique({
          where: { id: metadata.agentId },
          select: { name: true },
        });
        await activityService.recordActivity(metadata.projectId, {
          type: 'agent.connected',
          actorType: 'agent',
          actorId: metadata.agentId,
          actorName: connectedAgent?.name,
          message: `${connectedAgent?.name ?? 'An agent'} connected`,
        });
        // Everyone's view of who is on the team just changed.
        await this.broadcastAgentRoster(metadata.projectId);
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

    // Handle inbound agent.prompt: the interactive line a connected CLI agent
    // types in its own terminal. Does two real things, both reusing existing,
    // already-tested infrastructure: shows up live on the agent's canvas card
    // (recordActivity, same as agent.log below) and becomes a real Task,
    // assigned directly to this same agent, and executed through the same
    // pipeline the workspace UI's task board already drives. The creator on
    // record is whoever authorised this connection: the connect-token's
    // issuing owner, or the session user for a browser-authenticated agent
    // connection, both already resolved into metadata.userId at handshake
    // time, so this can never create a task as a different user or in a
    // different project than the one this connection was authorised for.
    if (message.type === AGENT_PROMPT_TYPE) {
      if (!metadata.authenticated || !metadata.agentId || !metadata.userId) {
        this.sendError(metadata.socket, 'UNAUTHORIZED', 'Agent must be authenticated to submit a prompt');
        return;
      }

      try {
        const payload = (message as { payload?: Record<string, unknown> }).payload;
        const rawBody = typeof payload?.body === 'string' ? payload.body.trim() : '';

        if (!rawBody) {
          this.sendError(metadata.socket, 'INVALID_MESSAGE', 'Prompt cannot be empty');
          return;
        }

        const body =
          rawBody.length > AGENT_PROMPT_MAX_BODY_LENGTH
            ? rawBody.slice(0, AGENT_PROMPT_MAX_BODY_LENGTH)
            : rawBody;
        const title =
          body.length > AGENT_PROMPT_MAX_TITLE_LENGTH
            ? `${body.slice(0, AGENT_PROMPT_MAX_TITLE_LENGTH - 1)}…`
            : body;

        const agent = await prisma.agent.findUnique({
          where: { id: metadata.agentId },
          select: { id: true, name: true, projectId: true },
        });

        if (!agent || agent.projectId !== metadata.projectId) {
          this.sendError(metadata.socket, 'AGENT_NOT_FOUND', 'Agent not found in this project');
          return;
        }

        // Live display, same real path as agent.log.
        const { activityService } = await import('../services/activity.service.js');
        await activityService.recordActivity(metadata.projectId, {
          type: AGENT_LOG_ACTIVITY_TYPE,
          actorType: 'agent',
          actorId: metadata.agentId,
          actorName: agent.name,
          message: body,
        });

        // Real task, created, self-assigned, and executed through the exact
        // pipeline the UI uses.
        const { taskService } = await import('../tasks/task.service.js');
        const { executionService } = await import('../execution/execution.service.js');
        const { ApprovalRequiredError } = await import('../errors/app-error.js');

        const task = await taskService.createTask(metadata.projectId, metadata.userId, {
          title,
          description: body,
          priority: TaskPriority.MEDIUM,
          filePaths: [],
        });

        await taskService.assignResponsibility(metadata.projectId, task.id, metadata.userId, {
          agentId: metadata.agentId,
          role: 'Requested by agent from its own terminal',
        });

        try {
          const execution = await executionService.createExecution(
            metadata.projectId,
            task.id,
            metadata.userId,
            { agentId: metadata.agentId },
          );
          this.sendJson(metadata.socket, {
            type: 'agent.prompt.accepted',
            payload: { taskId: task.id, executionId: execution.id },
          } as unknown as WebSocketMessage);
        } catch (execErr: unknown) {
          if (execErr instanceof ApprovalRequiredError) {
            // Real policy gate did its job: the task exists, but a human
            // must approve execution in the workspace before it runs.
            this.sendJson(metadata.socket, {
              type: 'agent.prompt.accepted',
              payload: {
                taskId: task.id,
                approvalRequired: true,
                approvalRequestId: execErr.approvalRequestId,
              },
            } as unknown as WebSocketMessage);
          } else {
            throw execErr;
          }
        }
      } catch (err: unknown) {
        const error = err as Error;
        this.sendError(metadata.socket, 'AGENT_PROMPT_FAILED', error?.message || 'Failed to process prompt');
      }
      return;
    }

    // Handle inbound agent.log: a free-text line an agent process posts to its
    // own workspace, distinct from agent.message (which is agent-to-agent and
    // requires a recipient). Not part of the versioned agent-protocol package;
    // built and read as a plain envelope on the wire, the same way
    // useWorkspaceRealtime already hand-builds workspace.resync.request
    // client-side. Delivery reuses activityService.recordActivity verbatim:
    // the same real persistence + broadcast path already proven for
    // agent.connected/agent.disconnected, so a log line survives in the
    // Activity feed and reaches every connected viewer as a live delta,
    // with no new persistence or broadcast logic of its own.
    if (message.type === AGENT_LOG_TYPE) {
      if (!metadata.authenticated || !metadata.agentId) {
        this.sendError(metadata.socket, 'UNAUTHORIZED', 'Agent must be authenticated to post a log line');
        return;
      }

      try {
        const payload = (message as { payload?: Record<string, unknown> }).payload;
        const rawBody = typeof payload?.body === 'string' ? payload.body.trim() : '';

        if (!rawBody) {
          this.sendError(metadata.socket, 'INVALID_MESSAGE', 'Log body cannot be empty');
          return;
        }

        const body = rawBody.length > AGENT_LOG_MAX_LENGTH ? rawBody.slice(0, AGENT_LOG_MAX_LENGTH) : rawBody;

        const agent = await prisma.agent.findUnique({
          where: { id: metadata.agentId },
          select: { id: true, name: true, projectId: true },
        });

        if (!agent || agent.projectId !== metadata.projectId) {
          this.sendError(metadata.socket, 'AGENT_NOT_FOUND', 'Agent not found in this project');
          return;
        }

        const { activityService } = await import('../services/activity.service.js');
        await activityService.recordActivity(metadata.projectId, {
          type: AGENT_LOG_ACTIVITY_TYPE,
          actorType: 'agent',
          actorId: metadata.agentId,
          actorName: agent.name,
          message: body,
        });
      } catch (err: unknown) {
        const error = err as Error;
        this.sendError(metadata.socket, 'AGENT_LOG_FAILED', error?.message || 'Failed to post log line');
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

  /**
   * Rebuilds the agent roster from the database plus live connection state and
   * pushes it to every connected agent in the project. Called whenever that
   * picture changes: a handshake, or an agent dropping off.
   */
  private async broadcastAgentRoster(projectId: string): Promise<void> {
    try {
      const agents = await prisma.agent.findMany({
        where: { projectId },
        select: { id: true, name: true, provider: true, status: true },
        orderBy: { createdAt: 'asc' },
      });

      const roster = agents.map((a) => ({
        agentId: a.id,
        name: a.name,
        provider: a.provider,
        online: connectionManager.isAgentConnected(projectId, a.id),
        status: a.status,
      }));

      connectionManager.broadcastToProjectAgents(projectId, {
        type: AGENT_ROSTER_TYPE,
        payload: { projectId, agents: roster },
      } as unknown as WebSocketMessage);
    } catch (err) {
      logger.error('[WebSocket] Failed to broadcast agent roster:', err);
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
