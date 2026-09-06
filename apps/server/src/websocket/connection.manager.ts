import type { WebSocket } from 'ws';
import crypto from 'node:crypto';
import { ConnectionMetadata, WebSocketMessage } from './websocket.types.js';

export class ConnectionManager {
  private connections: Map<string, ConnectionMetadata> = new Map();
  private projectRooms: Map<string, Set<string>> = new Map();

  addConnection(
    projectId: string,
    socket: WebSocket,
    httpSessionId?: string,
  ): ConnectionMetadata {
    const connectionId = crypto.randomUUID();
    const metadata: ConnectionMetadata = {
      connectionId,
      projectId,
      socket,
      connectedAt: new Date(),
      lastHeartbeat: Date.now(),
      isAlive: true,
      httpSessionId,
      authenticated: false,
    };

    this.connections.set(connectionId, metadata);

    let room = this.projectRooms.get(projectId);
    if (!room) {
      room = new Set();
      this.projectRooms.set(projectId, room);
    }
    room.add(connectionId);

    return metadata;
  }

  getActiveAgentConnectionsCount(agentId: string): number {
    let count = 0;
    for (const conn of this.connections.values()) {
      if (conn.authenticated && conn.agentId === agentId) {
        count++;
      }
    }
    return count;
  }

  getAuthenticatedAgentConnections(agentId: string): ConnectionMetadata[] {
    const result: ConnectionMetadata[] = [];
    for (const conn of this.connections.values()) {
      if (conn.authenticated && conn.agentId === agentId) {
        result.push(conn);
      }
    }
    return result;
  }

  removeConnection(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    const room = this.projectRooms.get(conn.projectId);
    if (room) {
      room.delete(connectionId);
      if (room.size === 0) {
        this.projectRooms.delete(conn.projectId);
      }
    }

    this.connections.delete(connectionId);
  }

  getConnection(connectionId: string): ConnectionMetadata | undefined {
    return this.connections.get(connectionId);
  }

  getProjectConnections(projectId: string): ConnectionMetadata[] {
    const room = this.projectRooms.get(projectId);
    if (!room) return [];

    const result: ConnectionMetadata[] = [];
    for (const connectionId of room) {
      const conn = this.connections.get(connectionId);
      if (conn) {
        result.push(conn);
      }
    }
    return result;
  }

  broadcastToProject(
    projectId: string,
    message: WebSocketMessage | string,
    senderConnectionId?: string,
  ): void {
    const connections = this.getProjectConnections(projectId);
    const dataToSend = typeof message === 'string' ? message : JSON.stringify(message);

    for (const conn of connections) {
      if (senderConnectionId && conn.connectionId === senderConnectionId) {
        continue;
      }
      if (conn.socket.readyState === conn.socket.OPEN) {
        conn.socket.send(dataToSend);
      }
    }
  }

  getAllConnections(): ConnectionMetadata[] {
    return Array.from(this.connections.values());
  }

  clear(): void {
    for (const conn of this.connections.values()) {
      if (
        conn.socket.readyState === conn.socket.OPEN ||
        conn.socket.readyState === conn.socket.CONNECTING
      ) {
        conn.socket.terminate();
      }
    }
    this.connections.clear();
    this.projectRooms.clear();
  }
}

export const connectionManager = new ConnectionManager();
