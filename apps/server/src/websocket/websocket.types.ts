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
}
