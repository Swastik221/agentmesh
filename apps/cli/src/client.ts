import WebSocket from 'ws';
import {
  AgentMeshMessageType,
  createAgentMeshMessage,
  parseAgentMeshMessage,
  AgentMeshMessage,
} from '@agentmesh/agent-protocol';
import { AgentAdapter, TaskExecutionContext } from './adapter/agent-adapter.interface.js';

export interface ClientOptions {
  serverUrl: string;
  workspaceId: string;
  agentId: string;
  sessionId?: string;
  token?: string;
  adapter?: AgentAdapter;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
}

export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'REGISTERING'
  | 'REGISTERED'
  | 'FAILED';

export class AgentMeshClient {
  private serverUrl: string;
  private workspaceId: string;
  private agentId: string;
  private sessionId: string;
  private adapter: AgentAdapter;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private reconnectIntervalMs: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private isExplicitClose = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: ClientOptions) {
    this.serverUrl = options.serverUrl;
    this.workspaceId = options.workspaceId;
    this.agentId = options.agentId;
    this.sessionId = options.sessionId || options.token || '';
    this.adapter = options.adapter || ({
      getIdentity: async () => ({ id: options.agentId, name: 'DefaultAgent', provider: 'default' }),
      getCapabilities: async () => ({ capabilities: [] }),
      executeTask: async () => ({ summary: 'Default execution' }),
    });
    this.reconnectIntervalMs = options.reconnectIntervalMs || 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public isConnected(): boolean {
    return this.state === 'REGISTERED' || this.state === 'CONNECTED';
  }

  public setAdapter(adapter: AgentAdapter): void {
    this.adapter = adapter;
  }

  public async connect(): Promise<void> {
    this.isExplicitClose = false;
    this.state = 'CONNECTING';

    const wsUrl = this.buildWsUrl();
    const headers = {
      Authorization: `Bearer ${this.sessionId}`,
      Cookie: `agentmesh_session=${this.sessionId}`,
    };

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl, { headers });

        this.ws.on('open', async () => {
          this.state = 'CONNECTED';
          this.reconnectAttempts = 0;
          try {
            await this.registerAgent();
          } catch (err) {
            reject(err);
          }
        });

        this.ws.on('message', async (data: WebSocket.RawData) => {
          await this.handleMessage(data.toString());
          if (this.state === 'REGISTERED') {
            resolve();
          } else if (this.state === 'FAILED') {
            reject(new Error('Handshake failed'));
          }
        });

        this.ws.on('close', () => {
          this.state = 'DISCONNECTED';
          if (!this.isExplicitClose) {
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (err: Error) => {
          if (this.state === 'CONNECTING' || this.state === 'REGISTERING') {
            this.state = 'FAILED';
            reject(err);
          }
        });
      } catch (err) {
        this.state = 'FAILED';
        reject(err);
      }
    });
  }

  private buildWsUrl(): string {
    const base = this.serverUrl.replace(/^http/, 'ws');
    const url = new URL(base.endsWith('/ws') ? base : `${base}/ws`);
    url.searchParams.set('projectId', this.workspaceId);
    return url.toString();
  }

  private async registerAgent(): Promise<void> {
    this.state = 'REGISTERING';

    const { capabilities } = await this.adapter.getCapabilities();

    const handshakeMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.AGENT_HANDSHAKE,
      projectId: this.workspaceId,
      senderId: this.agentId,
      payload: {
        agentId: this.agentId,
        clientVersion: '0.1.0',
        capabilities,
      },
    });

    this.sendJson(handshakeMsg);
  }

  private async handleMessage(rawMessageText: string): Promise<void> {
    let message: AgentMeshMessage;
    try {
      const parsedRaw = JSON.parse(rawMessageText);
      message = parseAgentMeshMessage(parsedRaw);
    } catch {
      return;
    }

    switch (message.type) {
      case AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED: {
        this.state = 'REGISTERED';
        break;
      }

      case AgentMeshMessageType.AGENT_HANDSHAKE_REJECTED: {
        this.state = 'FAILED';
        this.disconnect();
        break;
      }

      case AgentMeshMessageType.TASK_REQUEST: {
        await this.handleTaskRequest(message.payload);
        break;
      }

      case AgentMeshMessageType.TASK_STATUS: {
        if (message.payload.status === 'CANCELLED' && this.adapter.cancelTask) {
          await this.adapter.cancelTask(message.payload.taskId);
        }
        break;
      }

      default:
        break;
    }
  }

  private async handleTaskRequest(payload: {
    taskId: string;
    executionId?: string;
    title: string;
    description: string;
    requiredCapabilities?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    // 1. Send task.accepted / IN_PROGRESS
    const acceptMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_ACCEPTED,
      projectId: this.workspaceId,
      senderId: this.agentId,
      payload: {
        taskId: payload.taskId,
        executionId: payload.executionId,
      },
    });
    this.sendJson(acceptMsg);

    // 2. Execute locally via adapter
    const context: TaskExecutionContext = {
      taskId: payload.taskId,
      executionId: payload.executionId,
      title: payload.title,
      description: payload.description,
      requiredCapabilities: payload.requiredCapabilities,
      metadata: payload.metadata,
    };

    try {
      const result = await this.adapter.executeTask(context);

      const completedMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.TASK_COMPLETED,
        projectId: this.workspaceId,
        senderId: this.agentId,
        payload: {
          taskId: payload.taskId,
          executionId: payload.executionId,
          result: result.output || { summary: result.summary },
        },
      });
      this.sendJson(completedMsg);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Execution failed';
      const failedMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.TASK_FAILED,
        projectId: this.workspaceId,
        senderId: this.agentId,
        payload: {
          taskId: payload.taskId,
          executionId: payload.executionId,
          error: errorMessage,
        },
      });
      this.sendJson(failedMsg);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectIntervalMs * Math.min(this.reconnectAttempts, 5);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  private sendJson(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  public disconnect(): void {
    this.isExplicitClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = 'DISCONNECTED';
  }
}
