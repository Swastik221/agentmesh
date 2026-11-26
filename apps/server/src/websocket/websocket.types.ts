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
  /**
   * Declared in the handshake. Only `executor` connections (or ones that
   * declared nothing, the historical behaviour) receive tasks and make the
   * agent count as online. `terminal` and `observer` connections exist next to
   * a running executor and must never be mistaken for one.
   */
  connectionRole?: 'executor' | 'terminal' | 'observer';
  /** Terminal sessions this connection streams, as their owner. */
  ownedTerminalIds?: Set<string>;
  /** Terminal sessions this connection is viewing. */
  subscribedTerminalIds?: Set<string>;
  /** Recent message ids, to drop duplicates and replays on this connection. */
  recentMessageIds?: string[];
  connectToken?: {
    agentId: string;
    projectId: string;
    issuedByUserId: string;
  };
}
