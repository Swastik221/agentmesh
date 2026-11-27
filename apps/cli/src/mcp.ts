import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  CoordinationMessageType,
  workspaceContextSchema,
  type WorkspaceContext,
} from '@agentmesh/agent-protocol';
import { AgentMeshClient } from './client.js';
import { resolveCredentials, type CredentialOptions } from './credentials.js';

/**
 * `agentmesh mcp`: an MCP server (stdio) that lets a coding agent — Claude
 * Code, Codex, anything that speaks MCP — use the AgentMesh workspace as tools.
 *
 * It is a thin client. It holds one WebSocket to the AgentMesh server,
 * authenticated as a single registered agent with that agent's connect token,
 * in the `observer` role (it never receives or runs tasks). Every tool is a
 * protocol request the server authorises for that agent in that project:
 * nothing here decides permissions, and no tool runs anything on another
 * developer's machine, reads private terminals, or completes or approves work.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_NOTIFICATIONS = 100;

type Json = Record<string, unknown>;

interface Pending {
  replyType: string;
  resolve: (payload: Json) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class AgentMeshToolClient {
  private client: AgentMeshClient;
  private pending = new Map<string, Pending>();
  /** Messages and context changes pushed by the server since the last check. */
  private notifications: Array<{ type: string; payload: Json; receivedAt: string }> = [];

  constructor(options: CredentialOptions) {
    const creds = resolveCredentials(options);
    this.client = new AgentMeshClient({
      serverUrl: creds.serverUrl,
      workspaceId: creds.workspaceId,
      agentId: creds.agentId,
      ...(creds.connectToken ? { connectToken: creds.connectToken } : {}),
      ...(creds.sessionId ? { sessionId: creds.sessionId } : {}),
      connectionRole: 'observer',
      quiet: true,
      maxReconnectAttempts: 1000,
      onFrame: (frame) => this.onFrame(frame as { type?: string; correlationId?: string; payload?: Json }),
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  disconnect(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Disconnected'));
    }
    this.pending.clear();
    this.client.disconnect();
  }

  private onFrame(frame: { type?: string; correlationId?: string; payload?: Json }): boolean {
    const payload = frame.payload ?? {};
    if (frame.correlationId && this.pending.has(frame.correlationId)) {
      const p = this.pending.get(frame.correlationId)!;
      if (frame.type === p.replyType) {
        this.pending.delete(frame.correlationId);
        clearTimeout(p.timer);
        p.resolve(payload);
        return true;
      }
      if (frame.type === 'error') {
        this.pending.delete(frame.correlationId);
        clearTimeout(p.timer);
        p.reject(new Error(`${String(payload.code)}: ${String(payload.message)}`));
        return true;
      }
    }
    if (
      frame.type === CoordinationMessageType.AGENT_COORDINATE_DELIVERY ||
      frame.type === CoordinationMessageType.WORKSPACE_CONTEXT_CHANGED
    ) {
      this.notifications.push({ type: frame.type, payload, receivedAt: new Date().toISOString() });
      if (this.notifications.length > MAX_NOTIFICATIONS) this.notifications.shift();
      return true;
    }
    return frame.type === 'error';
  }

  /** Sends one protocol request and resolves with the correlated reply payload. */
  request(type: string, payload: unknown, replyType: string): Promise<Json> {
    if (!this.client.isConnected()) {
      return Promise.reject(new Error('Not connected to AgentMesh; it will retry automatically. Try again shortly.'));
    }
    return new Promise((resolve, reject) => {
      const id = this.client.sendFrame(type, payload);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('AgentMesh did not answer in time'));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { replyType, resolve, reject, timer });
    });
  }

  async context(focus?: { taskId?: string; filePaths?: string[] }): Promise<WorkspaceContext> {
    const clean = focus && (focus.taskId || focus.filePaths?.length) ? { focus } : {};
    const reply = await this.request(CoordinationMessageType.WORKSPACE_CONTEXT_REQUEST, clean, CoordinationMessageType.WORKSPACE_CONTEXT);
    return workspaceContextSchema.parse(reply.context);
  }

  takeNotifications(): Array<{ type: string; payload: Json; receivedAt: string }> {
    return this.notifications.splice(0);
  }
}

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

const failure = (err: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
});

/** Wraps a tool body so a refusal from the server comes back as a tool error, not a crash. */
const tool =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A) => {
    try {
      return text(await fn(args));
    } catch (err) {
      return failure(err);
    }
  };

/** Finds an agent in the context by id or (case-insensitive) name. */
function findAgent(ctx: WorkspaceContext, ref: string) {
  const needle = ref.trim().toLowerCase();
  return ctx.agents.find((a) => a.agentId === ref.trim() || a.name.toLowerCase() === needle);
}

const intent = z.enum(['ASK', 'ANSWER', 'PROPOSE', 'ACKNOWLEDGE', 'HANDOFF', 'BLOCKED', 'CONFLICT']);
const files = z.array(z.string().min(1).max(500)).max(100);

/** Registers every AgentMesh tool on `server`, backed by `am`. */
export function registerAgentMeshTools(server: McpServer, am: AgentMeshToolClient): void {
  // ---------------------------------------------------------- workspace

  server.registerTool(
    'get_workspace_overview',
    {
      title: 'Workspace overview',
      description:
        'Start here. Summarises the AgentMesh workspace: which agents are online and what they are working on, open and blocked tasks, ' +
        'overlaps with your work, handoff notes, shared terminals and unread messages. Call this before starting a task.',
      annotations: { readOnlyHint: true },
    },
    tool(async () => {
      const ctx = await am.context();
      return {
        project: ctx.project.name,
        you: ctx.self,
        agents: ctx.agents.map((a) => ({
          name: a.name,
          owner: a.owner.ensName || a.owner.displayName,
          online: a.online,
          working_on: a.currentTasks.map((t) => `${t.title} [${t.status}]`),
        })),
        tasks: {
          active: ctx.tasks.filter((t) => t.status === 'IN_PROGRESS').length,
          blocked: ctx.tasks.filter((t) => t.blocked).map((t) => t.title),
          unassigned: ctx.tasks.filter((t) => t.assignedAgents.length === 0).map((t) => ({ taskId: t.taskId, title: t.title })),
        },
        overlaps: ctx.overlaps.map((o) => o.explanation),
        handoffs: ctx.handoffs.map((h) => ({ artifactId: h.artifactId, task: h.taskTitle, from: h.from?.name, summary: h.note.summary })),
        shared_terminals: ctx.terminals.map((t) => ({ terminalId: t.terminalId, name: t.name, owner: t.owner.displayName, status: t.status })),
        unread_messages: ctx.pendingMessages,
        notifications_since_last_check: am.takeNotifications(),
      };
    }),
  );

  server.registerTool(
    'get_project_context',
    {
      title: 'Full workspace context',
      description:
        'The complete structured context (agents, tasks with dependencies, artifacts, worktrees, terminals, decisions, handoffs, overlaps). ' +
        'Pass the files you are about to change and/or a task id to get overlap warnings specific to that work.',
      inputSchema: { taskId: z.string().optional(), filePaths: files.optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ taskId, filePaths }: { taskId?: string; filePaths?: string[] }) => am.context({ taskId, filePaths })),
  );

  server.registerTool(
    'list_connected_agents',
    {
      title: 'List agents',
      description: 'Other agents in this workspace with owner, capabilities, online state and current tasks.',
      inputSchema: { onlineOnly: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ onlineOnly }: { onlineOnly?: boolean }) => {
      const ctx = await am.context();
      return ctx.agents.filter((a) => !onlineOnly || a.online);
    }),
  );

  server.registerTool(
    'list_terminal_sessions',
    {
      title: 'List terminals',
      description: "Terminal sessions you can see: your developer's own and teammates' shared (read-only) ones. Private terminals of others are never listed.",
      annotations: { readOnlyHint: true },
    },
    tool(async () => (await am.context()).terminals),
  );

  server.registerTool(
    'get_terminal_output',
    {
      title: 'Read a shared terminal',
      description: 'Recent output (secrets redacted, best effort) of a terminal you may view. Read-only: there is no way to type into it.',
      inputSchema: { terminalId: z.string().min(1), maxBytes: z.number().int().min(1).max(65536).optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ terminalId, maxBytes }: { terminalId: string; maxBytes?: number }) =>
      am.request(CoordinationMessageType.TERMINAL_TAIL_REQUEST, { terminalId, ...(maxBytes && { maxBytes }) }, CoordinationMessageType.TERMINAL_TAIL),
    ),
  );

  // --------------------------------------------------------------- tasks

  server.registerTool(
    'list_workspace_tasks',
    {
      title: 'List tasks',
      description: 'Open tasks (TODO, IN_PROGRESS, PENDING_APPROVAL, BLOCKED) with assignees, dependencies and blocked state.',
      inputSchema: { mine: z.boolean().optional(), status: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ mine, status }: { mine?: boolean; status?: string }) => {
      const ctx = await am.context();
      return ctx.tasks.filter(
        (t) => (!mine || t.assignedAgents.some((a) => a.agentId === ctx.self.agentId)) && (!status || t.status === status),
      );
    }),
  );

  server.registerTool(
    'get_task_details',
    {
      title: 'Task details',
      description: 'One task with its dependencies, artifacts, handoff notes and overlap warnings.',
      inputSchema: { taskId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ taskId }: { taskId: string }) =>
      (await am.request(CoordinationMessageType.TASK_DETAILS_REQUEST, { taskId }, CoordinationMessageType.TASK_DETAILS)).task,
    ),
  );

  server.registerTool(
    'get_task_dependencies',
    {
      title: 'Task dependencies',
      description: 'What a task is waiting on, and whether each dependency is satisfied.',
      inputSchema: { taskId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ taskId }: { taskId: string }) => {
      const task = (await am.request(CoordinationMessageType.TASK_DETAILS_REQUEST, { taskId }, CoordinationMessageType.TASK_DETAILS)).task as Json;
      return { taskId, blocked: task.blocked, dependsOn: task.dependsOn };
    }),
  );

  server.registerTool(
    'get_task_conflicts',
    {
      title: 'Check for conflicts',
      description:
        'Overlaps between a task (and/or files you plan to change) and other agents\' work: shared files, the same task, or unfinished upstream work. ' +
        'Advisory: it reflects declared files and assignments, it does not guarantee a conflict-free merge.',
      inputSchema: { taskId: z.string().optional(), filePaths: files.optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ taskId, filePaths }: { taskId?: string; filePaths?: string[] }) => (await am.context({ taskId, filePaths })).overlaps),
  );

  server.registerTool(
    'update_task_status',
    {
      title: 'Update my task status',
      description:
        'Move a task assigned to you to TODO, IN_PROGRESS or BLOCKED. Completing a task is not available here: finish by publishing results or a handoff note, and a human reviews it.',
      inputSchema: { taskId: z.string().min(1), status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED']), reason: z.string().max(1000).optional() },
    },
    tool(async (args: { taskId: string; status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED'; reason?: string }) =>
      am.request(CoordinationMessageType.TASK_STATUS_UPDATE, args, CoordinationMessageType.TASK_STATUS_UPDATED),
    ),
  );

  // -------------------------------------------------------------- agents

  server.registerTool(
    'get_agent_details',
    {
      title: 'Agent details',
      description: 'One agent by id or name: owner, provider, capabilities, online state and current tasks.',
      inputSchema: { agent: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ agent }: { agent: string }) => {
      const ctx = await am.context();
      const found = findAgent(ctx, agent);
      if (!found) throw new Error(`No agent "${agent}" in this workspace`);
      return found;
    }),
  );

  server.registerTool(
    'find_agents_by_capability',
    {
      title: 'Find agents by capability',
      description: 'Agents registered with a capability (e.g. "frontend", "backend").',
      inputSchema: { capability: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ capability }: { capability: string }) => {
      const ctx = await am.context();
      const c = capability.trim().toLowerCase();
      return ctx.agents.filter((a) => a.capabilities.includes(c));
    }),
  );

  server.registerTool(
    'get_agent_current_work',
    {
      title: "Agent's current work",
      description: 'What an agent is working on right now, including the files those tasks touch.',
      inputSchema: { agent: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ agent }: { agent: string }) => {
      const ctx = await am.context();
      const found = findAgent(ctx, agent);
      if (!found) throw new Error(`No agent "${agent}" in this workspace`);
      return { agent: found.name, online: found.online, tasks: found.currentTasks };
    }),
  );

  // ----------------------------------------------------------- artifacts

  server.registerTool(
    'list_artifacts',
    {
      title: 'List artifacts',
      description: 'Recent artifacts (results, contracts, handoff notes) with producer and review status. Use get_artifact_details for the content.',
      inputSchema: { taskId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ taskId }: { taskId?: string }) => {
      const ctx = await am.context();
      return ctx.artifacts.filter((a) => !taskId || a.taskId === taskId);
    }),
  );

  server.registerTool(
    'get_artifact_details',
    {
      title: 'Artifact details',
      description: 'One artifact including its payload (e.g. an API contract or a handoff note).',
      inputSchema: { artifactId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ artifactId }: { artifactId: string }) =>
      (await am.request(CoordinationMessageType.ARTIFACT_GET_REQUEST, { artifactId }, CoordinationMessageType.ARTIFACT_DETAILS)).artifact,
    ),
  );

  server.registerTool(
    'request_artifact_handoff',
    {
      title: 'Ask for a handoff',
      description: "Ask the agents on a task to hand off its results (contract, files, decisions). Sends an ASK; their answer arrives in check_inbox.",
      inputSchema: { taskId: z.string().min(1), what: z.string().min(1).max(2000) },
    },
    tool(async ({ taskId, what }: { taskId: string; what: string }) =>
      am.request(
        CoordinationMessageType.AGENT_COORDINATE,
        { taskId, intent: 'ASK', subject: 'Handoff requested', body: what, data: { requested: 'handoff' } },
        CoordinationMessageType.AGENT_COORDINATE_ACCEPTED,
      ),
    ),
  );

  // -------------------------------------------------------- coordination

  server.registerTool(
    'send_agent_message',
    {
      title: 'Message an agent',
      description:
        'Send a structured message to another agent (by name or id) or to every agent on a task. Queued if they are offline. ' +
        'Use intent ASK/ANSWER/PROPOSE/ACKNOWLEDGE/BLOCKED/CONFLICT; set inReplyTo when answering.',
      inputSchema: {
        to: z.string().optional(),
        taskId: z.string().optional(),
        intent,
        subject: z.string().min(1).max(200),
        body: z.string().max(8000).optional(),
        data: z.record(z.unknown()).optional(),
        inReplyTo: z.string().optional(),
      },
    },
    tool(
      async (args: {
        to?: string;
        taskId?: string;
        intent: z.infer<typeof intent>;
        subject: string;
        body?: string;
        data?: Json;
        inReplyTo?: string;
      }) => {
        let recipientAgentId: string | undefined;
        if (args.to) {
          const found = findAgent(await am.context(), args.to);
          if (!found) throw new Error(`No agent "${args.to}" in this workspace`);
          recipientAgentId = found.agentId;
        }
        if (!recipientAgentId && !args.taskId) throw new Error('Say who to send to: `to` (an agent) or `taskId`');
        return am.request(
          CoordinationMessageType.AGENT_COORDINATE,
          {
            ...(recipientAgentId && { recipientAgentId }),
            ...(args.taskId && { taskId: args.taskId }),
            intent: args.intent,
            subject: args.subject,
            body: args.body ?? '',
            ...(args.data && { data: args.data }),
            ...(args.inReplyTo && { inReplyTo: args.inReplyTo }),
          },
          CoordinationMessageType.AGENT_COORDINATE_ACCEPTED,
        );
      },
    ),
  );

  server.registerTool(
    'request_agent_context',
    {
      title: 'Ask an agent',
      description: 'Ask another agent a question about its work (an API contract, a decision). Sends an ASK; the answer arrives in check_inbox.',
      inputSchema: { agent: z.string().min(1), question: z.string().min(1).max(4000), taskId: z.string().optional() },
    },
    tool(async ({ agent, question, taskId }: { agent: string; question: string; taskId?: string }) => {
      const found = findAgent(await am.context(), agent);
      if (!found) throw new Error(`No agent "${agent}" in this workspace`);
      return am.request(
        CoordinationMessageType.AGENT_COORDINATE,
        { recipientAgentId: found.agentId, ...(taskId && { taskId }), intent: 'ASK', subject: question.slice(0, 200), body: question },
        CoordinationMessageType.AGENT_COORDINATE_ACCEPTED,
      );
    }),
  );

  server.registerTool(
    'check_inbox',
    {
      title: 'Check inbox',
      description: 'Messages other agents sent you (answers, proposals, handoffs) that you have not acknowledged, plus workspace changes pushed since the last check.',
      inputSchema: { includeAcknowledged: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ includeAcknowledged }: { includeAcknowledged?: boolean }) => {
      const inbox = await am.request(
        CoordinationMessageType.AGENT_INBOX_REQUEST,
        includeAcknowledged ? { includeAcknowledged } : {},
        CoordinationMessageType.AGENT_INBOX,
      );
      return { messages: inbox.messages, notifications: am.takeNotifications() };
    }),
  );

  server.registerTool(
    'acknowledge_message',
    {
      title: 'Acknowledge a message',
      description: 'Mark a message from check_inbox as handled.',
      inputSchema: { messageId: z.string().min(1) },
    },
    tool(async ({ messageId }: { messageId: string }) =>
      am.request(CoordinationMessageType.AGENT_COORDINATE_ACK, { messageId }, CoordinationMessageType.AGENT_COORDINATE_ACKED),
    ),
  );

  server.registerTool(
    'publish_handoff_note',
    {
      title: 'Publish a handoff note',
      description:
        'Record what the next agent needs: summary, work done, files changed, API contracts, assumptions, decisions, open questions, risks and validation. ' +
        'Stored as a "handoff" artifact on the task (subject to the project\'s artifact policy, which may need human approval) and sent to agents whose tasks depend on it.',
      inputSchema: {
        taskId: z.string().min(1),
        summary: z.string().min(1).max(2000),
        workCompleted: z.array(z.string()).optional(),
        filesModified: z.array(z.string()).optional(),
        apiContracts: z.array(z.object({ name: z.string(), description: z.string().optional(), spec: z.string().optional() })).optional(),
        assumptions: z.array(z.string()).optional(),
        decisions: z.array(z.string()).optional(),
        openQuestions: z.array(z.string()).optional(),
        dependencies: z.array(z.string()).optional(),
        risks: z.array(z.string()).optional(),
        validation: z.array(z.string()).optional(),
        artifactRefs: z.array(z.string()).optional(),
        to: z.string().optional(),
      },
    },
    tool(async ({ taskId, to, ...note }: { taskId: string; to?: string; summary: string } & Json) => {
      let recipientAgentId: string | undefined;
      if (to) {
        const found = findAgent(await am.context(), to);
        if (!found) throw new Error(`No agent "${to}" in this workspace`);
        recipientAgentId = found.agentId;
      }
      return am.request(
        CoordinationMessageType.HANDOFF_PUBLISH,
        { taskId, note, ...(recipientAgentId && { recipientAgentId }) },
        CoordinationMessageType.HANDOFF_PUBLISHED,
      );
    }),
  );

  server.registerTool(
    'report_blocker',
    {
      title: 'Report a blocker',
      description: 'Mark one of your tasks BLOCKED with a reason. Agents whose work depends on it are notified, and it shows on the task board.',
      inputSchema: { taskId: z.string().min(1), reason: z.string().min(1).max(1000) },
    },
    tool(async ({ taskId, reason }: { taskId: string; reason: string }) =>
      am.request(CoordinationMessageType.TASK_STATUS_UPDATE, { taskId, status: 'BLOCKED', reason }, CoordinationMessageType.TASK_STATUS_UPDATED),
    ),
  );

  server.registerTool(
    'report_file_activity',
    {
      title: 'Report files you are changing',
      description:
        'Declare the files you are changing for one of your tasks, so other agents see it and overlap detection works. Returns any overlaps with other agents\' work.',
      inputSchema: { taskId: z.string().min(1), filePaths: files.min(1) },
    },
    tool(async ({ taskId, filePaths }: { taskId: string; filePaths: string[] }) =>
      am.request(CoordinationMessageType.FILE_ACTIVITY_REPORT, { taskId, filePaths }, CoordinationMessageType.FILE_ACTIVITY_RECORDED),
    ),
  );
}

export async function runMcp(options: CredentialOptions): Promise<void> {
  // stdout is the MCP channel. Anything else printed there corrupts it.
  console.log = (...args: unknown[]) => console.error(...args);

  const am = new AgentMeshToolClient(options);
  await am.connect();

  const server = new McpServer(
    { name: 'agentmesh', version: '0.1.0' },
    {
      instructions:
        'AgentMesh connects you to a shared workspace with other developers\' coding agents. Before starting a task, call get_workspace_overview ' +
        '(and get_task_conflicts with the files you plan to change) to see who is working on what. Ask other agents with request_agent_context, ' +
        'read their handoff notes with get_artifact_details, report the files you change with report_file_activity, and publish a handoff note when you finish. ' +
        'Check check_inbox for answers. You cannot complete or approve tasks: humans review results.',
    },
  );
  registerAgentMeshTools(server, am);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    am.disconnect();
    void server.close().finally(() => process.exit(0));
  };
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
