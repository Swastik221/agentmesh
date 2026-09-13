import type { WebSocket } from 'ws';

export interface WebSocketMessage<T = unknown> {
  type: string;
  payload: T;
}

export enum WSMessageType {
  PING = 'ping',
  PONG = 'pong',
  ERROR = 'error',
}

export interface WSErrorPayload {
  code: string;
  message: string;
}

export interface ConnectionMetadata {
  connectionId: string;
  projectId: string;
  socket: WebSocket;
  connectedAt: Date;
  lastHeartbeat: number;
  isAlive: boolean;
  httpSessionId?: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  authenticated: boolean;
  /**
   * Set when the connection presented an agent connect token instead of a SIWE
   * session. Scoped to exactly this agent in this project; it never stands in
   * for a user login anywhere else.
   */
  connectToken?: {
    agentId: string;
    projectId: string;
    issuedByUserId: string;
  };
}
