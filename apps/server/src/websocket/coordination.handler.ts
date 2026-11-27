import { randomUUID } from 'node:crypto';
import {
  AgentMeshMessageType,
  CoordinationMessageType,
  PROTOCOL_VERSION,
  parseCoordinationMessage,
} from '@agentmesh/agent-protocol';
import { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';
import { terminalService } from '../terminals/terminal.service.js';
import { workspaceContextService } from '../context/workspace-context.service.js';
import { agentCoordinationService } from '../coordination/agent-coordination.service.js';
import { ApprovalRequiredError } from '../errors/app-error.js';
import type { ConnectionMetadata } from './websocket.types.js';

/** How many recent message ids a connection remembers for duplicate detection. */
const RECENT_ID_WINDOW = 256;

function sendFrame(conn: ConnectionMetadata, type: string, payload: unknown, correlationId?: string): void {
  if (conn.socket.readyState !== conn.socket.OPEN) return;
  conn.socket.send(
    JSON.stringify({
      id: randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
      projectId: conn.projectId,
      senderId: 'server',
      timestamp: new Date().toISOString(),
      ...(correlationId && { correlationId }),
      type,
      payload,
    }),
  );
}

function sendError(conn: ConnectionMetadata, code: string, message: string, correlationId?: string): void {
  sendFrame(conn, AgentMeshMessageType.ERROR, { code, message }, correlationId);
}

/**
 * True when this connection has already seen `id`. A replayed or duplicated
 * frame is dropped instead of being applied twice.
 */
function isDuplicate(conn: ConnectionMetadata, id: unknown): boolean {
  if (typeof id !== 'string') return false;
  conn.recentMessageIds ??= [];
  if (conn.recentMessageIds.includes(id)) return true;
  conn.recentMessageIds.push(id);
  if (conn.recentMessageIds.length > RECENT_ID_WINDOW) conn.recentMessageIds.shift();
  return false;
}

const requireAgent = (conn: ConnectionMetadata): conn is ConnectionMetadata & { agentId: string; userId: string } =>
  Boolean(conn.authenticated && conn.agentId && conn.userId);

const requireViewer = (conn: ConnectionMetadata): conn is ConnectionMetadata & { userId: string } =>
  Boolean(conn.authenticated && conn.userId && !conn.agentId);

/**
 * Handles terminal and workspace-context messages. Every message is validated
 * against the protocol schema, scoped to the connection's own project, and
 * authorised for the kind of connection that sent it.
 */
export async function handleCoordinationMessage(conn: ConnectionMetadata, raw: unknown): Promise<void> {
  const rawObj = raw as { id?: unknown; type?: unknown; projectId?: unknown };
  const correlationId = typeof rawObj.id === 'string' ? rawObj.id : undefined;

  // Remote control is out of scope by design: refuse it explicitly, so it is
  // obvious to a client author that it is not merely unimplemented.
  if (rawObj.type === CoordinationMessageType.TERMINAL_INPUT) {
    sendError(conn, 'TERMINAL_INPUT_FORBIDDEN', 'Terminals are read-only for everyone but their owner, who types locally', correlationId);
    return;
  }

  if (!conn.authenticated) {
    sendError(conn, 'UNAUTHORIZED', 'Authenticate before sending workspace messages', correlationId);
    return;
  }

  if (isDuplicate(conn, rawObj.id)) {
    return;
  }

  const parsed = parseCoordinationMessage(raw);
  if (!parsed.ok) {
    sendError(conn, 'INVALID_MESSAGE', parsed.error, correlationId);
    return;
  }
  const message = parsed.message;

  if (message.projectId !== conn.projectId) {
    sendError(conn, 'PROJECT_MISMATCH', 'Message is for a different project than this connection', correlationId);
    return;
  }

  try {
    switch (message.type) {
      case CoordinationMessageType.TERMINAL_OPEN: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can open a terminal', correlationId);
        const { session, resumed } = await terminalService.open(conn, message.payload);
        sendFrame(
          conn,
          CoordinationMessageType.TERMINAL_OPENED,
          { terminalId: session.id, visibility: session.visibility, status: session.status, resumed },
          correlationId,
        );
        return;
      }

      case CoordinationMessageType.TERMINAL_OUTPUT: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can write terminal output', correlationId);
        await terminalService.output(conn, message.payload.terminalId, message.payload.data);
        return;
      }

      case CoordinationMessageType.TERMINAL_UPDATE: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only the terminal owner can change it', correlationId);
        const { terminalId, ...change } = message.payload;
        await terminalService.update(conn.projectId, terminalId, conn.userId, change, conn.connectionId);
        return;
      }

      case CoordinationMessageType.TERMINAL_CLOSE: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only the terminal owner can close it', correlationId);
        await terminalService.close(conn.projectId, message.payload.terminalId, conn.userId, conn.connectionId);
        return;
      }

      case CoordinationMessageType.TERMINAL_SUBSCRIBE: {
        if (!requireViewer(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a signed-in viewer can watch a terminal', correlationId);
        await terminalService.subscribe(conn, message.payload.terminalId);
        return;
      }

      case CoordinationMessageType.TERMINAL_UNSUBSCRIBE: {
        terminalService.unsubscribe(conn, message.payload.terminalId);
        return;
      }

      case CoordinationMessageType.WORKSPACE_CONTEXT_REQUEST: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can request agent context', correlationId);
        const context = await workspaceContextService.buildForAgent(
          conn.projectId,
          conn.agentId,
          conn.userId,
          message.payload.focus ?? {},
        );
        sendFrame(conn, CoordinationMessageType.WORKSPACE_CONTEXT, { context }, correlationId);
        return;
      }

      case CoordinationMessageType.TERMINAL_TAIL_REQUEST: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can read a terminal tail', correlationId);
        const tail = await terminalService.tail(conn.projectId, message.payload.terminalId, conn.userId, message.payload.maxBytes);
        sendFrame(conn, CoordinationMessageType.TERMINAL_TAIL, { terminalId: message.payload.terminalId, ...tail }, correlationId);
        return;
      }

      case CoordinationMessageType.AGENT_COORDINATE: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can send coordination messages', correlationId);
        const result = await agentCoordinationService.send(conn, message.payload, message.id);
        sendFrame(conn, CoordinationMessageType.AGENT_COORDINATE_ACCEPTED, result, correlationId);
        return;
      }

      case CoordinationMessageType.AGENT_COORDINATE_ACK: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can acknowledge messages', correlationId);
        await agentCoordinationService.acknowledge(conn, message.payload.messageId);
        sendFrame(conn, CoordinationMessageType.AGENT_COORDINATE_ACKED, { messageId: message.payload.messageId }, correlationId);
        return;
      }

      case CoordinationMessageType.AGENT_INBOX_REQUEST: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent has an inbox', correlationId);
        const messages = await agentCoordinationService.inbox(conn, message.payload.includeAcknowledged, message.payload.limit);
        sendFrame(conn, CoordinationMessageType.AGENT_INBOX, { messages }, correlationId);
        return;
      }

      case CoordinationMessageType.HANDOFF_PUBLISH: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can publish a handoff', correlationId);
        const result = await agentCoordinationService.publishHandoff(conn, message.payload, message.id);
        sendFrame(conn, CoordinationMessageType.HANDOFF_PUBLISHED, result, correlationId);
        return;
      }

      case CoordinationMessageType.TASK_DETAILS_REQUEST: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can read task details', correlationId);
        const ctx = await workspaceContextService.buildForAgent(conn.projectId, conn.agentId, conn.userId, {
          taskId: message.payload.taskId,
        });
        const task = ctx.tasks.find((t) => t.taskId === message.payload.taskId);
        const detail = task ?? (await workspaceContextService.describeTask(conn.projectId, message.payload.taskId));
        sendFrame(
          conn,
          CoordinationMessageType.TASK_DETAILS,
          {
            task: {
              ...detail,
              artifacts: ctx.artifacts.filter((a) => a.taskId === message.payload.taskId),
              handoffs: ctx.handoffs.filter((h) => h.taskId === message.payload.taskId),
              overlaps: ctx.overlaps,
            },
          },
          correlationId,
        );
        return;
      }

      case CoordinationMessageType.ARTIFACT_GET_REQUEST: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can read artifacts', correlationId);
        const artifact = await agentCoordinationService.artifactDetails(conn, message.payload.artifactId);
        sendFrame(conn, CoordinationMessageType.ARTIFACT_DETAILS, { artifact }, correlationId);
        return;
      }

      case CoordinationMessageType.TASK_STATUS_UPDATE: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can update its tasks', correlationId);
        const status = await agentCoordinationService.updateOwnTaskStatus(
          conn,
          message.payload.taskId,
          message.payload.status,
          message.payload.reason,
        );
        sendFrame(conn, CoordinationMessageType.TASK_STATUS_UPDATED, { taskId: message.payload.taskId, status }, correlationId);
        return;
      }

      case CoordinationMessageType.FILE_ACTIVITY_REPORT: {
        if (!requireAgent(conn)) return sendError(conn, 'UNAUTHORIZED', 'Only a connected agent can report file activity', correlationId);
        const result = await agentCoordinationService.reportFileActivity(conn, message.payload.taskId, message.payload.filePaths);
        sendFrame(conn, CoordinationMessageType.FILE_ACTIVITY_RECORDED, { taskId: message.payload.taskId, ...result }, correlationId);
        return;
      }

      default:
        sendError(conn, 'UNEXPECTED_MESSAGE', `'${message.type}' is sent by the server, not to it`, correlationId);
        return;
    }
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      sendFrame(
        conn,
        AgentMeshMessageType.ERROR,
        {
          code: 'APPROVAL_REQUIRED',
          message: `${err.message}. A human must approve it in the workspace (approval ${err.approvalRequestId}).`,
          details: { approvalRequestId: err.approvalRequestId },
        },
        correlationId,
      );
      return;
    }
    if (err instanceof AppError) {
      sendError(conn, err.code, err.message, correlationId);
      return;
    }
    logger.error(`[WebSocket] Coordination message ${message.type} failed:`, err);
    sendError(conn, 'INTERNAL_ERROR', 'Request failed', correlationId);
  }
}
