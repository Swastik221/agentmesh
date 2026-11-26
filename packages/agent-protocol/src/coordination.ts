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
