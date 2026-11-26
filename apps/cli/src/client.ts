import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import {
  AgentMeshMessageType,
  createAgentMeshMessage,
  parseAgentMeshMessage,
  AgentMeshMessage,
  PROTOCOL_VERSION,
} from '@agentmesh/agent-protocol';
import { AgentAdapter, TaskExecutionContext } from './adapter/agent-adapter.interface.js';

export interface ClientOptions {
  serverUrl: string;
  workspaceId: string;
  agentId: string;
  sessionId?: string;
  token?: string;
  /** Short-lived, agent-scoped credential. Preferred over a full session. */
  connectToken?: string;
  adapter?: AgentAdapter;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  /**
   * What this connection is for. Only `executor` (the default) receives tasks.
   * A terminal or a one-off context query declares its role so the server
   * never mistakes it for the agent being ready to work.
   */
  connectionRole?: ConnectionRole;
  /**
   * Sees every inbound frame first. Return true to mark it handled. Used by
   * the terminal and context commands for coordination messages.
   */
  onFrame?: (frame: { type?: string; correlationId?: string; payload?: unknown }) => boolean;
  /** Called after every accepted handshake, including after a reconnect. */
  onRegistered?: () => void;
  /** Keep printing task, team and board notices (the interactive REPL does). */
  quiet?: boolean;
}

export type ConnectionRole = 'executor' | 'terminal' | 'observer';

/** A teammate agent in the same project, as pushed by the server. */
export interface RosterAgent {
  agentId: string;
  name: string;
  online: boolean;
  provider?: string;
  status?: string;
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
  private connectToken: string;
  private adapter: AgentAdapter;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private reconnectIntervalMs: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private isExplicitClose = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** The server's own reason for rejecting the handshake, surfaced verbatim. */
  private lastRejection: string | null = null;
  /** Teammate agents in this project, pushed by the server as they change. */
  private roster: RosterAgent[] = [];
  private connectionRole: ConnectionRole;
  private onFrame?: ClientOptions['onFrame'];
  private onRegistered?: () => void;
  private quiet: boolean;

  constructor(options: ClientOptions) {
    this.serverUrl = options.serverUrl;
    this.workspaceId = options.workspaceId;
    this.agentId = options.agentId;
    this.sessionId = options.sessionId || options.token || '';
    this.connectToken = options.connectToken || '';
    this.adapter = options.adapter || ({
      getIdentity: async () => ({ id: options.agentId, name: 'DefaultAgent', provider: 'default' }),
      getCapabilities: async () => ({ capabilities: [] }),
      executeTask: async () => ({ summary: 'Default execution' }),
    });
    this.connectionRole = options.connectionRole ?? 'executor';
    this.onFrame = options.onFrame;
    this.onRegistered = options.onRegistered;
    this.quiet = options.quiet ?? false;
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
    // An agent-scoped connect token is sent on its own header so the server
    // never has to disambiguate it from a browser session.
    const headers: Record<string, string> = this.connectToken
      ? { 'x-agent-connect-token': this.connectToken }
      : {
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
            reject(new Error(this.lastRejection || 'Handshake failed'));
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
        // Omitted for executors so older servers, which reject unknown
        // handshake fields, keep accepting the default connector.
        ...(this.connectionRole !== 'executor' && { connectionRole: this.connectionRole }),
      },
    });

    this.sendJson(handshakeMsg);
  }

  private async handleMessage(rawMessageText: string): Promise<void> {
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(rawMessageText);
    } catch {
      return;
    }

    if (typeof parsedRaw === 'object' && parsedRaw !== null && this.onFrame?.(parsedRaw as { type?: string })) {
      return;
    }

    // Roster push: who else is on this team right now. Ad-hoc wire type, so it
    // is read before the strict protocol parse below would reject it.
    if (
      typeof parsedRaw === 'object' &&
      parsedRaw !== null &&
      (parsedRaw as { type?: string }).type === 'agent.roster'
    ) {
      const payload = (parsedRaw as { payload?: { agents?: RosterAgent[] } }).payload;
      this.roster = (payload?.agents ?? []).filter((a) => a.agentId !== this.agentId);
      return;
    }

    // Ad-hoc response to agent.prompt, not part of the versioned protocol
    // package (it is a CLI<->server convenience, not an inter-agent or
    // task-lifecycle contract type), so it is handled here before the strict
    // schema parse below would otherwise reject and silently drop it.
    if (
      typeof parsedRaw === 'object' &&
      parsedRaw !== null &&
      (parsedRaw as { type?: string }).type === 'agent.prompt.accepted'
    ) {
      const payload = (parsedRaw as { payload?: Record<string, unknown> }).payload || {};
      if (payload.approvalRequired) {
        console.log(
          `\n[prompt] Task created (${payload.taskId}). Execution needs human approval in the workspace before it can run.\n`,
        );
      } else {
        console.log(`\n[prompt] Task created and queued for execution (${payload.taskId}).\n`);
      }
      return;
    }

    // The open-offer listing, like agent.prompt.accepted above, is a CLI
    // convenience outside the versioned protocol, so it is handled before
    // strict parsing rather than being dropped by it.
    if (
      typeof parsedRaw === 'object' &&
      parsedRaw !== null &&
      (parsedRaw as { type?: string }).type === 'task.offers'
    ) {
      const payload = (parsedRaw as { payload?: { offers?: Array<Record<string, unknown>> } }).payload;
      const offers = payload?.offers ?? [];
      if (offers.length === 0) {
        console.log('\n[board] Nothing is open right now.\n');
      } else {
        console.log('\n[board] Open to any agent:');
        for (const offer of offers) {
          const left = typeof offer.offerExpiresAt === 'string'
            ? Math.max(0, Math.round((new Date(offer.offerExpiresAt).getTime() - Date.now()) / 1000))
            : null;
          console.log(
            `  ${offer.taskId}  ${offer.title}${left === null ? '' : `  (${left}s left)`}`,
          );
        }
        console.log('  Take one with /claim <id>\n');
      }
      return;
    }

    let message: AgentMeshMessage;
    try {
      message = parseAgentMeshMessage(parsedRaw);
    } catch {
      return;
    }

    switch (message.type) {
      case AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED: {
        this.state = 'REGISTERED';
        // The connect token from the UI lives ten minutes. Reconnect with the
        // rotating resume token instead, so a long session survives a network
        // drop or a server restart without a trip back to the browser.
        if (message.payload.resumeToken) {
          this.connectToken = message.payload.resumeToken;
        }
        this.onRegistered?.();
        break;
      }

      case AgentMeshMessageType.ERROR: {
        if (!this.quiet) {
          console.error(`\n[error] ${message.payload.code}: ${message.payload.message}\n`);
        }
        break;
      }

      // What the rest of the team is doing. The server records these as real
      // workspace activity and broadcasts them to every connected agent, so
      // this is how one agent learns another picked up or finished work.
      case AgentMeshMessageType.ACTIVITY_CREATED: {
        if (this.quiet) break;
        const p = message.payload;
        // An open offer is addressed to every agent including whoever posted
        // it, and it is actionable, so it gets its own line with the id needed
        // to claim it rather than scrolling past as ordinary team chatter.
        if (p.type === 'task.offered') {
          console.log(
            `\n[board] ${p.message ?? 'A task is open to any agent'}` +
              `${p.taskId ? `\n        take it with: /claim ${p.taskId}` : ''}\n`,
          );
          break;
        }
        if (p.actorId === this.agentId) break; // own actions already printed
        if (p.message) {
          // Name the actor unless the server sentence already opens with it,
          // so the feed always answers "who" without ever doubling it up.
          const actor = p.actorName;
          const named = actor && !p.message.startsWith(actor) ? `${actor}: ${p.message}` : p.message;
          console.log(`\n[team] ${named}\n`);
        }
        break;
      }

      // A direct message from another agent in this project.
      case AgentMeshMessageType.AGENT_MESSAGE: {
        const from = this.roster.find((a) => a.agentId === message.senderId);
        console.log(`\n[dm from ${from?.name ?? message.senderId}] ${message.payload.body}\n`);
        break;
      }

      case AgentMeshMessageType.AGENT_HANDSHAKE_REJECTED: {
        this.lastRejection = `${message.payload.code}: ${message.payload.message}`;
        this.state = 'FAILED';
        this.disconnect();
        break;
      }

      case AgentMeshMessageType.TASK_REQUEST: {
        // The server only dispatches to executors; never run work elsewhere.
        if (this.connectionRole === 'executor') {
          await this.handleTaskRequest(message.payload);
        }
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
    console.log(`\n[task] Received: ${payload.title}`);

    // Shared workspace context the server sends with every task: what the rest
    // of the team is doing right now, what has already been produced, and the
    // recorded decisions. Printed so the context is visible, and passed to the
    // adapter below in metadata so an adapter can actually act on it.
    const ctx = payload.metadata?.workspaceContext as
      | {
          activeWork?: Array<{ agent: string; task: string; status: string; filePaths?: string[] }>;
          availableArtifacts?: Array<{ name: string; type: string; producedBy?: string }>;
          decisions?: Array<{ type: string; title: string }>;
        }
      | undefined;

    if (ctx) {
      if (ctx.activeWork?.length) {
        console.log('[context] Teammates currently working on:');
        for (const w of ctx.activeWork) {
          const files = w.filePaths?.length ? ` (${w.filePaths.join(', ')})` : '';
          console.log(`  - ${w.agent}: ${w.task} [${w.status}]${files}`);
        }
      }
      if (ctx.availableArtifacts?.length) {
        console.log('[context] Artifacts already available:');
        for (const a of ctx.availableArtifacts) {
          console.log(`  - ${a.name} (${a.type})${a.producedBy ? ` by ${a.producedBy}` : ''}`);
        }
      }
      if (ctx.decisions?.length) {
        console.log('[context] Project decisions and constraints:');
        for (const d of ctx.decisions) {
          console.log(`  - [${d.type}] ${d.title}`);
        }
      }
    }

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
    const worktreePath =
      (payload.metadata?.worktreePath as string) ||
      (payload.metadata?.workingDirectory as string) ||
      undefined;

    const context: TaskExecutionContext = {
      taskId: payload.taskId,
      executionId: payload.executionId,
      title: payload.title,
      description: payload.description,
      requiredCapabilities: payload.requiredCapabilities,
      metadata: payload.metadata,
      worktreePath,
      onProgress: (progress: number, message?: string) => {
        console.log(`[task] ${progress}%${message ? ` — ${message}` : ''}`);
        const progressMsg = createAgentMeshMessage({
          type: AgentMeshMessageType.TASK_PROGRESS,
          projectId: this.workspaceId,
          senderId: this.agentId,
          payload: {
            taskId: payload.taskId,
            executionId: payload.executionId,
            progress,
            message,
          },
        });
        this.sendJson(progressMsg);
      },
      publishArtifact: async (artifact) => {
        console.log(`[task] Publishing artifact: ${artifact.name}`);
        const artifactMsg = createAgentMeshMessage({
          type: AgentMeshMessageType.ARTIFACT_CREATED,
          projectId: this.workspaceId,
          senderId: this.agentId,
          payload: {
            artifactId: `art-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            projectId: this.workspaceId,
            taskId: payload.taskId,
            executionId: payload.executionId,
            agentId: this.agentId,
            type: artifact.type,
            name: artifact.name,
            version: 1,
            payload: artifact.payload,
          } as unknown as import('@agentmesh/agent-protocol').ArtifactCreatedPayload,
        });



        this.sendJson(artifactMsg);
      },
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
      console.log(`[task] Completed: ${payload.title}\n`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Execution failed';
      console.error(`[task] Failed: ${errorMessage}\n`);
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

  /**
   * Posts a free-text line to the workspace, the way an interactive terminal
   * session would. Real over the wire: the server persists it through the
   * same activity pipeline as every other real event and broadcasts it live
   * to connected browsers, which is what makes it show up on this agent's
   * card. Not part of the versioned agent-protocol message set (agent.message
   * there is strictly agent-to-agent and requires a recipient), so this is
   * built by hand rather than through createAgentMeshMessage, mirroring how
   * the web client already hand-builds workspace.resync.request.
   */
  public sendLog(body: string): void {
    const trimmed = body.trim();
    if (!trimmed || !this.isConnected()) return;
    this.sendJson({
      id: randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
      projectId: this.workspaceId,
      senderId: this.agentId,
      timestamp: new Date().toISOString(),
      type: 'agent.log',
      payload: { body: trimmed },
    });
  }

  /**
   * Posts an interactive prompt: the same live display as sendLog, plus a
   * real Task the server creates, assigns to this agent, and dispatches back
   * over this same connection for real execution (see websocket.server.ts's
   * agent.prompt handler). This is what turns typing in this terminal into
   * actual work, the way running `claude` in a terminal does.
   */
  /** Teammate agents currently known to this connection. */
  public getRoster(): RosterAgent[] {
    return [...this.roster];
  }

  /**
   * Sends a direct message to another agent in this project, by name or id.
   * Uses the protocol's existing, already-validated agent.message path: the
   * server checks the recipient exists, is in the same project, and is
   * connected, and rejects the message otherwise.
   */
  public sendDirectMessage(target: string, body: string): boolean {
    const trimmed = body.trim();
    if (!trimmed || !this.isConnected()) return false;

    const needle = target.trim().toLowerCase();
    const match = this.roster.find(
      (a) => a.name.toLowerCase() === needle || a.agentId === target.trim(),
    );
    if (!match) return false;

    const msg = createAgentMeshMessage({
      type: AgentMeshMessageType.AGENT_MESSAGE,
      projectId: this.workspaceId,
      senderId: this.agentId,
      recipientId: match.agentId,
      payload: { body: trimmed },
    });
    this.sendJson(msg);
    return true;
  }

  /**
   * Takes an open offer off the shared task board for this agent.
   *
   * The server derives the agent from this authenticated connection, so the
   * task id is all it needs; an agent can never claim on another's behalf.
   * Success arrives as the ordinary task.assigned / task.request flow, and a
   * failure (someone else got there first) arrives as a normal error frame.
   */
  public claimOffer(taskId: string): void {
    const trimmed = taskId.trim();
    if (!trimmed || !this.isConnected()) return;
    this.sendJson({
      id: randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
      projectId: this.workspaceId,
      senderId: this.agentId,
      timestamp: new Date().toISOString(),
      type: 'task.claim',
      payload: { taskId: trimmed },
    });
  }

  /** Asks for the offers currently open to any agent in this project. */
  public requestOffers(): void {
    if (!this.isConnected()) return;
    this.sendJson({
      id: randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
      projectId: this.workspaceId,
      senderId: this.agentId,
      timestamp: new Date().toISOString(),
      type: 'task.offers',
      payload: {},
    });
  }

  public sendPrompt(body: string): void {
    const trimmed = body.trim();
    if (!trimmed || !this.isConnected()) return;
    this.sendJson({
      id: randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
      projectId: this.workspaceId,
      senderId: this.agentId,
      timestamp: new Date().toISOString(),
      type: 'agent.prompt',
      payload: { body: trimmed },
    });
  }

  /**
   * Sends a protocol envelope of any type and returns its id, which the
   * server echoes as `correlationId` on its reply.
   */
  public sendFrame(type: string, payload: unknown): string {
    const id = randomUUID();
    this.sendJson({
      id,
      protocolVersion: PROTOCOL_VERSION,
      projectId: this.workspaceId,
      senderId: this.agentId,
      timestamp: new Date().toISOString(),
      type,
      payload,
    });
    return id;
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
