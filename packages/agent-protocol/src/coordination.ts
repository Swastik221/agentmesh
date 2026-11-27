import { z } from 'zod';
import { baseEnvelopeSchema } from './schemas.js';

/**
 * Shared-canvas coordination messages: connected terminal sessions and
 * structured workspace context for agents.
 *
 * These ride the same envelope and WebSocket as the core protocol but are kept
 * in their own union, so adding them does not change what `parseAgentMeshMessage`
 * accepts for existing clients.
 *
 * Terminal privacy model, enforced by the server rather than by clients:
 * - A session is PRIVATE by default. Its output reaches only its owner.
 * - SHARED sessions are readable by project members. Nobody but the owner's
 *   own local process ever writes to a terminal: there is deliberately no
 *   input message, and `terminal.input` is rejected outright.
 * - Output is redacted for common secret shapes before it leaves the
 *   developer's machine and again on the server. That is best effort, not a
 *   guarantee.
 */
export const CoordinationMessageType = {
  /** agent → server: register or resume a local terminal session. */
  TERMINAL_OPEN: 'terminal.open',
  /** server → agent: the session id and its current visibility. */
  TERMINAL_OPENED: 'terminal.opened',
  /** agent → server, and server → authorised viewers: a chunk of output. */
  TERMINAL_OUTPUT: 'terminal.output',
  /** agent → server: change visibility or size. server → agent: owner changed it in the UI. */
  TERMINAL_UPDATE: 'terminal.update',
  /** agent → server: the local session ended. server → agent: owner disconnected it in the UI. */
  TERMINAL_CLOSE: 'terminal.close',
  /** viewer → server: start receiving a session's output. */
  TERMINAL_SUBSCRIBE: 'terminal.subscribe',
  /** viewer → server: stop receiving it. */
  TERMINAL_UNSUBSCRIBE: 'terminal.unsubscribe',
  /** server → viewer: recent buffered output, sent once on subscribe. */
  TERMINAL_SNAPSHOT: 'terminal.snapshot',
  /** server → project: a session's metadata changed (status, visibility, ...). */
  TERMINAL_SESSION_CHANGED: 'terminal.session.changed',
  /** server → viewer: access to a session was withdrawn (unshared or closed). */
  TERMINAL_REVOKED: 'terminal.revoked',
  /** Never accepted. Listed so the server can reject it explicitly. */
  TERMINAL_INPUT: 'terminal.input',
  /** agent → server: ask for structured workspace context. */
  WORKSPACE_CONTEXT_REQUEST: 'workspace.context.request',
  /** server → agent: the context. */
  WORKSPACE_CONTEXT: 'workspace.context',
  /** agent → server: recent redacted output of a SHARED terminal. */
  TERMINAL_TAIL_REQUEST: 'terminal.tail.request',
  /** server → agent: that output. */
  TERMINAL_TAIL: 'terminal.tail',

  // Structured agent-to-agent coordination (persisted, with delivery state).
  /** agent → server: send a structured message to an agent or a task's agents. */
  AGENT_COORDINATE: 'agent.coordinate',
  /** server → sender: stored, with how many recipients it reached. */
  AGENT_COORDINATE_ACCEPTED: 'agent.coordinate.accepted',
  /** server → recipient: a message for you (live, or queued while you were away). */
  AGENT_COORDINATE_DELIVERY: 'agent.coordinate.delivery',
  /** recipient → server: mark a message handled. */
  AGENT_COORDINATE_ACK: 'agent.coordinate.ack',
  /** server → recipient: the acknowledgement was recorded. */
  AGENT_COORDINATE_ACKED: 'agent.coordinate.acked',
  /** agent → server: list my messages. */
  AGENT_INBOX_REQUEST: 'agent.inbox.request',
  /** server → agent: the inbox. */
  AGENT_INBOX: 'agent.inbox',
  /** agent → server: publish a structured handoff note on a task. */
  HANDOFF_PUBLISH: 'handoff.publish',
  /** server → agent: the handoff artifact (and the message that announced it). */
  HANDOFF_PUBLISHED: 'handoff.published',
  /** agent → server: one task with dependencies, artifacts, handoffs and overlaps. */
  TASK_DETAILS_REQUEST: 'task.details.request',
  TASK_DETAILS: 'task.details',
  /** agent → server: one artifact including its payload. */
  ARTIFACT_GET_REQUEST: 'artifact.get.request',
  ARTIFACT_DETAILS: 'artifact.details',
  /** agent → server: move a task assigned to this agent (never to COMPLETED). */
  TASK_STATUS_UPDATE: 'task.status.update',
  TASK_STATUS_UPDATED: 'task.status.updated',
  /** agent → server: the files this agent is touching for one of its tasks. */
  FILE_ACTIVITY_REPORT: 'file.activity.report',
  FILE_ACTIVITY_RECORDED: 'file.activity.recorded',
  /** server → relevant agents: something that affects your work changed. */
  WORKSPACE_CONTEXT_CHANGED: 'workspace.context.changed',
} as const;

export type CoordinationMessageType =
  (typeof CoordinationMessageType)[keyof typeof CoordinationMessageType];

/** Largest output chunk a client may send in one message. */
export const TERMINAL_MAX_CHUNK_BYTES = 16 * 1024;

export const terminalVisibilitySchema = z.enum(['PRIVATE', 'SHARED']);
export type TerminalVisibility = z.infer<typeof terminalVisibilitySchema>;

export const terminalStatusSchema = z.enum(['ACTIVE', 'DISCONNECTED', 'CLOSED']);
export type TerminalStatus = z.infer<typeof terminalStatusSchema>;

const idSchema = z.string().trim().min(1).max(128);
const dims = z.number().int().min(1).max(1000);

export const terminalOpenPayloadSchema = z
  .object({
    /** Set when resuming a session this agent opened before a reconnect. */
    terminalId: idSchema.optional(),
    name: z.string().trim().min(1).max(80),
    command: z.string().trim().max(200).optional(),
    /** Display label for where the session runs: a directory or worktree. */
    cwd: z.string().trim().max(500).optional(),
    visibility: terminalVisibilitySchema.default('PRIVATE'),
    cols: dims.optional(),
    rows: dims.optional(),
  })
  .strict();

export const terminalOpenedPayloadSchema = z.object({
  terminalId: idSchema,
  visibility: terminalVisibilitySchema,
  status: terminalStatusSchema,
  resumed: z.boolean(),
});

export const terminalOutputPayloadSchema = z
  .object({
    terminalId: idSchema,
    /** UTF-8 text, possibly containing ANSI escape sequences. */
    data: z.string().max(TERMINAL_MAX_CHUNK_BYTES),
    /** Server-assigned, strictly increasing per session. Ignored when sent by an agent. */
    seq: z.number().int().nonnegative().optional(),
  })
  .strict();

export const terminalUpdatePayloadSchema = z
  .object({
    terminalId: idSchema,
    visibility: terminalVisibilitySchema.optional(),
    cols: dims.optional(),
    rows: dims.optional(),
  })
  .strict();

export const terminalIdPayloadSchema = z.object({ terminalId: idSchema }).strict();

export const terminalSessionSummarySchema = z.object({
  terminalId: idSchema,
  projectId: idSchema,
  name: z.string(),
  command: z.string().nullable(),
  cwd: z.string().nullable(),
  visibility: terminalVisibilitySchema,
  status: terminalStatusSchema,
  owner: z.object({ userId: idSchema, displayName: z.string().nullable() }),
  agent: z.object({ agentId: idSchema, name: z.string() }).nullable(),
  cols: z.number().int().nullable(),
  rows: z.number().int().nullable(),
  lastActiveAt: z.string(),
  createdAt: z.string(),
});
export type TerminalSessionSummary = z.infer<typeof terminalSessionSummarySchema>;

export const terminalSnapshotPayloadSchema = z.object({
  terminalId: idSchema,
  data: z.string(),
  seq: z.number().int().nonnegative(),
  /** True when older output was dropped from the bounded buffer. */
  truncated: z.boolean(),
  session: terminalSessionSummarySchema,
});

export const terminalSessionChangedPayloadSchema = z.object({
  session: terminalSessionSummarySchema,
});

export const terminalRevokedPayloadSchema = z.object({
  terminalId: idSchema,
  reason: z.enum(['UNSHARED', 'CLOSED', 'ACCESS_LOST']),
});

export const workspaceContextRequestPayloadSchema = z
  .object({
    /** Narrow overlap detection to what the agent is about to work on. */
    focus: z
      .object({
        taskId: idSchema.optional(),
        filePaths: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const terminalTailRequestPayloadSchema = z
  .object({
    terminalId: idSchema,
    maxBytes: z.number().int().min(1).max(64 * 1024).optional(),
  })
  .strict();

export const terminalTailPayloadSchema = z.object({
  terminalId: idSchema,
  data: z.string(),
  truncated: z.boolean(),
});

// ---------------------------------------------------------------------------
// Structured agent coordination
// ---------------------------------------------------------------------------

/**
 * Why one agent is talking to another. Every message is stored with its
 * intent and delivery state, and recorded as workspace activity, so the
 * humans can see what their agents agreed.
 */
export const agentIntentSchema = z.enum(['ASK', 'ANSWER', 'PROPOSE', 'ACKNOWLEDGE', 'HANDOFF', 'BLOCKED', 'CONFLICT']);
export type AgentIntent = z.infer<typeof agentIntentSchema>;

export const deliveryStateSchema = z.enum(['PENDING', 'DELIVERED', 'ACKNOWLEDGED']);
export type DeliveryState = z.infer<typeof deliveryStateSchema>;

/** Largest structured `data` attachment on a message, serialised. */
export const AGENT_MESSAGE_MAX_DATA_BYTES = 16 * 1024;

const shortText = z.string().trim().min(1).max(500);
const textList = z.array(shortText).max(50).default([]);

/**
 * A handoff note: what the next agent needs to continue without asking. Stored
 * as an artifact of type `handoff` on the task, so it goes through the same
 * policy and review gates as any other artifact, and is returned in the
 * context of agents whose work depends on that task.
 */
export const handoffNoteSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),
    workCompleted: textList,
    filesModified: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
    apiContracts: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(200),
            description: z.string().trim().max(2000).optional(),
            /** The contract itself: an OpenAPI fragment, a TypeScript type, an example request. */
            spec: z.string().max(8000).optional(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    assumptions: textList,
    decisions: textList,
    openQuestions: textList,
    dependencies: textList,
    risks: textList,
    validation: textList,
    artifactRefs: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
  })
  .strict();
export type HandoffNote = z.infer<typeof handoffNoteSchema>;

export const agentCoordinatePayloadSchema = z
  .object({
    /** One agent. Omit it and give `taskId` to address every agent on that task. */
    recipientAgentId: idSchema.optional(),
    taskId: idSchema.optional(),
    intent: agentIntentSchema,
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().max(8000).default(''),
    data: z.record(z.unknown()).optional(),
    /** The message this one answers or acknowledges. */
    inReplyTo: idSchema.optional(),
  })
  .strict()
  .refine((p) => p.recipientAgentId || p.taskId, {
    message: 'Address the message to an agent (recipientAgentId) or to a task (taskId)',
  });

export const agentMessageViewSchema = z.object({
  messageId: idSchema,
  intent: agentIntentSchema,
  from: z.object({ agentId: idSchema, name: z.string() }),
  recipientAgentId: idSchema,
  taskId: idSchema.nullable(),
  subject: z.string(),
  body: z.string(),
  data: z.record(z.unknown()).nullable(),
  inReplyTo: idSchema.nullable(),
  deliveryState: deliveryStateSchema,
  createdAt: z.string(),
});
export type AgentMessageView = z.infer<typeof agentMessageViewSchema>;

export const handoffViewSchema = z.object({
  artifactId: idSchema,
  taskId: idSchema,
  taskTitle: z.string(),
  from: z.object({ agentId: idSchema, name: z.string() }).nullable(),
  status: z.string(),
  createdAt: z.string(),
  note: handoffNoteSchema,
});
export type HandoffView = z.infer<typeof handoffViewSchema>;

export const contextChangeReasonSchema = z.enum([
  'TASK_ASSIGNED',
  'TASK_BLOCKED',
  'ARTIFACT_PUBLISHED',
  'HANDOFF',
  'AGENT_DISCONNECTED',
  'CONFLICT',
]);

/**
 * Structured, bounded picture of the workspace for one agent: who else is
 * here, what they are doing and where, and where that might collide with this
 * agent's work. Built from the database by the server; never includes private
 * terminal output, raw environment, or artifact payloads.
 */
export const workspaceContextSchema = z.object({
  generatedAt: z.string(),
  project: z.object({ projectId: idSchema, name: z.string() }),
  self: z.object({
    agentId: idSchema,
    name: z.string(),
    capabilities: z.array(z.string()),
  }),
  agents: z.array(
    z.object({
      agentId: idSchema,
      name: z.string(),
      provider: z.string(),
      owner: z.object({ userId: idSchema, displayName: z.string().nullable(), ensName: z.string().nullable() }),
      capabilities: z.array(z.string()),
      online: z.boolean(),
      status: z.string(),
      currentTasks: z.array(
        z.object({ taskId: idSchema, title: z.string(), status: z.string(), filePaths: z.array(z.string()) }),
      ),
    }),
  ),
  tasks: z.array(
    z.object({
      taskId: idSchema,
      title: z.string(),
      status: z.string(),
      priority: z.string(),
      filePaths: z.array(z.string()),
      assignedAgents: z.array(z.object({ agentId: idSchema, name: z.string() })),
      dependsOn: z.array(
        z.object({
          dependencyId: idSchema,
          type: z.string(),
          taskId: z.string().nullable(),
          taskTitle: z.string().nullable(),
          taskStatus: z.string().nullable(),
          artifactId: z.string().nullable(),
          artifactName: z.string().nullable(),
          satisfied: z.boolean(),
        }),
      ),
      blocked: z.boolean(),
      openOffer: z.boolean(),
    }),
  ),
  artifacts: z.array(
    z.object({
      artifactId: idSchema,
      name: z.string(),
      type: z.string(),
      version: z.number().int(),
      status: z.string(),
      taskId: idSchema,
      producedBy: z.object({ agentId: idSchema, name: z.string() }).nullable(),
      createdAt: z.string(),
    }),
  ),
  worktrees: z.array(
    z.object({
      worktreeId: idSchema,
      agentId: idSchema,
      agentName: z.string(),
      taskId: idSchema,
      branch: z.string().nullable(),
      status: z.string(),
    }),
  ),
  terminals: z.array(terminalSessionSummarySchema),
  decisions: z.array(z.object({ type: z.string(), title: z.string(), content: z.string() })),
  /** Handoff notes on tasks this agent's work depends on, and recent ones in the project. */
  handoffs: z.array(handoffViewSchema).default([]),
  /** Messages to this agent it has not acknowledged yet. */
  pendingMessages: z.number().int().nonnegative().default(0),
  overlaps: z.array(
    z.object({
      kind: z.enum(['FILE', 'TASK']),
      /** The other agent's task that collides with this agent's work. */
      taskId: idSchema,
      taskTitle: z.string(),
      agentId: idSchema.nullable(),
      agentName: z.string().nullable(),
      filePaths: z.array(z.string()),
      explanation: z.string(),
    }),
  ),
});
export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;

const msg = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  baseEnvelopeSchema.extend({ type: z.literal(type), payload });

export const coordinationMessageSchema = z.discriminatedUnion('type', [
  msg(CoordinationMessageType.TERMINAL_OPEN, terminalOpenPayloadSchema),
  msg(CoordinationMessageType.TERMINAL_OPENED, terminalOpenedPayloadSchema),
  msg(CoordinationMessageType.TERMINAL_OUTPUT, terminalOutputPayloadSchema),
  msg(CoordinationMessageType.TERMINAL_UPDATE, terminalUpdatePayloadSchema),
  msg(CoordinationMessageType.TERMINAL_CLOSE, terminalIdPayloadSchema),
  msg(CoordinationMessageType.TERMINAL_SUBSCRIBE, terminalIdPayloadSchema),
  msg(CoordinationMessageType.TERMINAL_UNSUBSCRIBE, terminalIdPayloadSchema),
  msg(CoordinationMessageType.TERMINAL_SNAPSHOT, terminalSnapshotPayloadSchema),
  msg(CoordinationMessageType.TERMINAL_SESSION_CHANGED, terminalSessionChangedPayloadSchema),
  msg(CoordinationMessageType.TERMINAL_REVOKED, terminalRevokedPayloadSchema),
  msg(CoordinationMessageType.WORKSPACE_CONTEXT_REQUEST, workspaceContextRequestPayloadSchema),
  msg(CoordinationMessageType.WORKSPACE_CONTEXT, z.object({ context: workspaceContextSchema })),
  msg(CoordinationMessageType.TERMINAL_TAIL_REQUEST, terminalTailRequestPayloadSchema),
  msg(CoordinationMessageType.TERMINAL_TAIL, terminalTailPayloadSchema),
  msg(CoordinationMessageType.AGENT_COORDINATE, agentCoordinatePayloadSchema),
  msg(
    CoordinationMessageType.AGENT_COORDINATE_ACCEPTED,
    z.object({ messageIds: z.array(idSchema), delivered: z.number().int(), queued: z.number().int() }),
  ),
  msg(CoordinationMessageType.AGENT_COORDINATE_DELIVERY, agentMessageViewSchema),
  msg(CoordinationMessageType.AGENT_COORDINATE_ACK, z.object({ messageId: idSchema }).strict()),
  msg(CoordinationMessageType.AGENT_COORDINATE_ACKED, z.object({ messageId: idSchema })),
  msg(
    CoordinationMessageType.AGENT_INBOX_REQUEST,
    z.object({ includeAcknowledged: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  ),
  msg(CoordinationMessageType.AGENT_INBOX, z.object({ messages: z.array(agentMessageViewSchema) })),
  msg(
    CoordinationMessageType.HANDOFF_PUBLISH,
    z
      .object({
        taskId: idSchema,
        name: z.string().trim().min(1).max(200).optional(),
        note: handoffNoteSchema,
        /** Also tell this agent directly. Agents on dependent tasks are always told. */
        recipientAgentId: idSchema.optional(),
      })
      .strict(),
  ),
  msg(
    CoordinationMessageType.HANDOFF_PUBLISHED,
    z.object({ artifactId: idSchema, status: z.string(), notified: z.number().int() }),
  ),
  msg(CoordinationMessageType.TASK_DETAILS_REQUEST, z.object({ taskId: idSchema }).strict()),
  msg(CoordinationMessageType.TASK_DETAILS, z.object({ task: z.record(z.unknown()) })),
  msg(CoordinationMessageType.ARTIFACT_GET_REQUEST, z.object({ artifactId: idSchema }).strict()),
  msg(CoordinationMessageType.ARTIFACT_DETAILS, z.object({ artifact: z.record(z.unknown()) })),
  msg(
    CoordinationMessageType.TASK_STATUS_UPDATE,
    z
      .object({
        taskId: idSchema,
        status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED']),
        reason: z.string().trim().max(1000).optional(),
      })
      .strict(),
  ),
  msg(CoordinationMessageType.TASK_STATUS_UPDATED, z.object({ taskId: idSchema, status: z.string() })),
  msg(
    CoordinationMessageType.FILE_ACTIVITY_REPORT,
    z
      .object({
        taskId: idSchema,
        filePaths: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
        note: z.string().trim().max(500).optional(),
      })
      .strict(),
  ),
  msg(
    CoordinationMessageType.FILE_ACTIVITY_RECORDED,
    z.object({ taskId: idSchema, filePaths: z.array(z.string()), overlaps: z.array(z.record(z.unknown())) }),
  ),
  msg(
    CoordinationMessageType.WORKSPACE_CONTEXT_CHANGED,
    z.object({
      reason: contextChangeReasonSchema,
      summary: z.string(),
      taskId: idSchema.optional(),
      artifactId: idSchema.optional(),
      agentId: idSchema.optional(),
    }),
  ),
]);

export type CoordinationMessage = z.infer<typeof coordinationMessageSchema>;

const COORDINATION_TYPES = new Set<string>(Object.values(CoordinationMessageType));

/** True when `type` belongs to the coordination message family. */
export function isCoordinationMessageType(type: unknown): type is CoordinationMessageType {
  return typeof type === 'string' && COORDINATION_TYPES.has(type);
}

/**
 * Validates a coordination message. Returns the typed message, or an error
 * string suitable for an ERROR frame.
 */
export function parseCoordinationMessage(
  raw: unknown,
): { ok: true; message: CoordinationMessage } | { ok: false; error: string } {
  const result = coordinationMessageSchema.safeParse(raw);
  if (result.success) return { ok: true, message: result.data };
  const first = result.error.issues[0];
  return { ok: false, error: first ? `${first.path.join('.') || 'message'}: ${first.message}` : 'Invalid message' };
}
