/**
 * AgentMesh Typed WebSocket Client & Realtime Boundary
 *
 * Manages WebSocket connections between the frontend and the AgentMesh backend.
 * Provides auto-reconnect, message parsing, event subscriptions, and project scoping.
 */

import { envConfig } from '../config/env';

export type WsStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

export type WsMessageHandler<T = unknown> = (data: T) => void;
export type WsStatusHandler = (status: WsStatus) => void;

export class WebSocketClient {
  private socket: WebSocket | null = null;
  private status: WsStatus = 'DISCONNECTED';
  private messageListeners: Set<WsMessageHandler> = new Set();
  private statusListeners: Set<WsStatusHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private currentProjectId: string | null = null;

  constructor(private wsUrlProvider: () => string = () => envConfig.wsUrl) {}

  public get getStatus(): WsStatus {
    return this.status;
  }

  public connect(projectId?: string): void {
    if (projectId) {
      this.currentProjectId = projectId;
    }

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus('CONNECTING');
    const baseUrl = this.wsUrlProvider().replace(/\/$/, '');
    const wsUrl = this.currentProjectId ? `${baseUrl}?projectId=${encodeURIComponent(this.currentProjectId)}` : baseUrl;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('CONNECTED');
      };

      this.socket.onmessage = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);
          this.messageListeners.forEach((listener) => listener(parsed));
        } catch {
          this.messageListeners.forEach((listener) => listener(event.data));
        }
      };

      this.socket.onerror = () => {
        // Handled in onclose for reconnect logic
      };

      this.socket.onclose = () => {
        this.setStatus('DISCONNECTED');
        this.socket = null;
        this.attemptReconnect();
      };
    } catch {
      this.setStatus('DISCONNECTED');
      this.attemptReconnect();
    }
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    this.setStatus('DISCONNECTED');
  }

  public send(data: unknown): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      this.socket.send(payload);
    }
  }

  public onMessage<T = unknown>(handler: WsMessageHandler<T>): () => void {
    this.messageListeners.add(handler as WsMessageHandler);
    return () => {
      this.messageListeners.delete(handler as WsMessageHandler);
    };
  }

  public onStatusChange(handler: WsStatusHandler): () => void {
    this.statusListeners.add(handler);
    handler(this.status);
    return () => {
      this.statusListeners.delete(handler);
    };
  }

  private setStatus(newStatus: WsStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.statusListeners.forEach((handler) => handler(newStatus));
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }
    this.reconnectAttempts++;
    this.setStatus('RECONNECTING');
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}

export const wsClient = new WebSocketClient();
