import type { Server as HTTPServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { connectionManager } from './connection.manager.js';
import { ConnectionMetadata, WebSocketMessage, WSMessageType } from './websocket.types.js';

export class AgentMeshWebSocketServer {
  private wss: WebSocketServer;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(server: HTTPServer, heartbeatIntervalMs = 30000) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req: IncomingMessage, socket, head) => {
      this.handleUpgrade(req, socket as Duplex, head);
    });

    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage, projectId: string) => {
      this.handleConnection(ws, projectId);
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

  private handleConnection(ws: WebSocket, projectId: string): void {
    const metadata = connectionManager.addConnection(projectId, ws);
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

    ws.on('close', () => {
      logger.info(
        `[WebSocket] Connection ${metadata.connectionId} closed for project ${projectId}`,
      );
      connectionManager.removeConnection(metadata.connectionId);
    });

    ws.on('error', (err) => {
      logger.error(`[WebSocket] Error on connection ${metadata.connectionId}:`, err);
      connectionManager.removeConnection(metadata.connectionId);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
  }

  private handleIncomingMessage(metadata: ConnectionMetadata, rawData: RawData): void {
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

    switch (message.type) {
      case WSMessageType.PING:
        this.sendJson(metadata.socket, {
          type: WSMessageType.PONG,
          payload: {},
        });
        break;

      case WSMessageType.PONG:
        // Heartbeat response acknowledged
        break;

      default:
        // Unknown message types handled gracefully
        break;
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
