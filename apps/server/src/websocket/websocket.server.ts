import type { Server as HTTPServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { AgentMeshMessageType } from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { connectionManager } from './connection.manager.js';
import { ConnectionMetadata, WebSocketMessage, WSMessageType } from './websocket.types.js';
import { handshakeService, HandshakeErrorCode } from '../handshake/index.js';

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

  private handleConnection(ws: WebSocket, req: IncomingMessage, projectId: string): void {
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
      this.handleIncomingMessage(metadata, data);
    });

    ws.on('close', async () => {
      logger.info(
        `[WebSocket] Connection ${metadata.connectionId} closed for project ${projectId}`,
      );
      connectionManager.removeConnection(metadata.connectionId);
      await handshakeService.handleDisconnection(metadata);
    });

    ws.on('error', (err) => {
      logger.error(`[WebSocket] Error on connection ${metadata.connectionId}:`, err);
      connectionManager.removeConnection(metadata.connectionId);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
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
