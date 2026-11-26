import {
  CoordinationMessageType,
  workspaceContextSchema,
  type WorkspaceContext,
} from '@agentmesh/agent-protocol';
import { AgentMeshClient } from './client.js';
import { resolveCredentials, type CredentialOptions } from './credentials.js';

/**
 * `agentmesh context`: print what the rest of the workspace is doing, as seen
 * by this agent, then exit.
 *
 * Meant to be run by the coding agent itself before it starts work (Claude
 * Code, Codex and others can run shell commands), so it can find out who else
 * is working on what, on which files, and what it depends on, instead of its
 * developer relaying that by hand. `--json` gives the structured form.
 */

export interface ContextOptions extends CredentialOptions {
  json?: boolean;
  /** Comma-separated paths the agent is about to change. */
  files?: string;
  taskId?: string;
  /** Print a SHARED terminal's recent output instead. */
  tail?: string;
}

const TIMEOUT_MS = 10_000;

export function formatContext(ctx: WorkspaceContext): string {
  const lines: string[] = [];
  const push = (s = '') => lines.push(s);

  push(`Workspace "${ctx.project.name}", as seen by ${ctx.self.name}`);
  push();

  if (ctx.overlaps.length > 0) {
    push('Check before you start:');
    for (const o of ctx.overlaps) push(`  ! ${o.explanation}`);
    push();
  }

  push('Other agents:');
  if (ctx.agents.length === 0) push('  (none yet)');
  for (const a of ctx.agents) {
    const owner = a.owner.ensName || a.owner.displayName || 'unknown owner';
    const caps = a.capabilities.length ? ` [${a.capabilities.join(', ')}]` : '';
    push(`  ${a.online ? '●' : '○'} ${a.name} (${a.provider}, owned by ${owner})${caps}`);
    for (const t of a.currentTasks) {
      const files = t.filePaths.length ? ` — ${t.filePaths.join(', ')}` : '';
      push(`      ${t.status.padEnd(16)} ${t.title}${files}`);
    }
  }
  push();

  const open = ctx.tasks.filter((t) => t.assignedAgents.length === 0);
  if (open.length > 0) {
    push('Unassigned tasks:');
    for (const t of open) push(`  ${t.taskId}  ${t.title}${t.openOffer ? '  (open offer: /claim it)' : ''}${t.blocked ? '  (blocked)' : ''}`);
    push();
  }

  const blocked = ctx.tasks.filter((t) => t.blocked && t.assignedAgents.length > 0);
  if (blocked.length > 0) {
    push('Blocked:');
    for (const t of blocked) {
      const waiting = t.dependsOn.filter((d) => !d.satisfied).map((d) => d.taskTitle || d.artifactName || d.type);
      push(`  ${t.title} — waiting on ${waiting.join(', ') || 'a dependency'}`);
    }
    push();
  }

  if (ctx.artifacts.length > 0) {
    push('Recent artifacts:');
    for (const a of ctx.artifacts.slice(0, 10)) {
      push(`  ${a.name} (${a.type} v${a.version}, ${a.status})${a.producedBy ? ` by ${a.producedBy.name}` : ''}`);
    }
    push();
  }

  if (ctx.worktrees.length > 0) {
    push('Active worktrees:');
    for (const w of ctx.worktrees) push(`  ${w.agentName}: ${w.branch ?? '(no branch)'}`);
    push();
  }

  if (ctx.terminals.length > 0) {
    push('Terminals you can see:');
    for (const t of ctx.terminals) {
      const who = t.agent ? `${t.owner.displayName ?? 'someone'} / ${t.agent.name}` : t.owner.displayName ?? 'someone';
      push(`  ${t.terminalId}  ${t.name} (${who}) ${t.visibility.toLowerCase()}, ${t.status.toLowerCase()}${t.cwd ? ` in ${t.cwd}` : ''}`);
    }
    push('  Read one with: agentmesh context --tail <terminal-id>');
    push();
  }

  if (ctx.decisions.length > 0) {
    push('Project decisions:');
    for (const d of ctx.decisions) push(`  [${d.type}] ${d.title}`);
  }
  return lines.join('\n').trimEnd();
}

/** Connects as an observer, sends one request, and returns the matching reply. */
async function ask<T>(options: ContextOptions, type: string, payload: unknown, replyType: string): Promise<T> {
  const creds = resolveCredentials(options);
  let requestId: string | undefined;
  let settle: { resolve: (v: T) => void; reject: (e: Error) => void } | undefined;

  const client = new AgentMeshClient({
    serverUrl: creds.serverUrl,
    workspaceId: creds.workspaceId,
    agentId: creds.agentId,
    ...(creds.connectToken ? { connectToken: creds.connectToken } : {}),
    ...(creds.sessionId ? { sessionId: creds.sessionId } : {}),
    connectionRole: 'observer',
    quiet: true,
    maxReconnectAttempts: 0,
    onFrame: (frame) => {
      if (!requestId || frame.correlationId !== requestId) return false;
      const p = (frame.payload ?? {}) as Record<string, unknown>;
      if (frame.type === replyType) settle?.resolve(p as T);
      else if (frame.type === 'error') settle?.reject(new Error(`${p.code as string}: ${p.message as string}`));
      return true;
    },
  });

  await client.connect();
  try {
    return await new Promise<T>((resolve, reject) => {
      settle = { resolve, reject };
      const timer = setTimeout(() => reject(new Error('Timed out waiting for the server')), TIMEOUT_MS);
      timer.unref?.();
      requestId = client.sendFrame(type, payload);
    });
  } finally {
    client.disconnect();
  }
}

export async function fetchContext(options: ContextOptions): Promise<WorkspaceContext> {
  const filePaths = options.files?.split(',').map((f) => f.trim()).filter(Boolean);
  const focus = {
    ...(options.taskId && { taskId: options.taskId }),
    ...(filePaths?.length && { filePaths }),
  };
  const reply = await ask<{ context: unknown }>(
    options,
    CoordinationMessageType.WORKSPACE_CONTEXT_REQUEST,
    Object.keys(focus).length ? { focus } : {},
    CoordinationMessageType.WORKSPACE_CONTEXT,
  );
  return workspaceContextSchema.parse(reply.context);
}

export async function runContext(options: ContextOptions): Promise<void> {
  if (options.tail) {
    const tail = await ask<{ data: string; truncated: boolean }>(
      options,
      CoordinationMessageType.TERMINAL_TAIL_REQUEST,
      { terminalId: options.tail },
      CoordinationMessageType.TERMINAL_TAIL,
    );
    if (options.json) {
      console.log(JSON.stringify(tail, null, 2));
    } else {
      if (tail.truncated) console.log('[earlier output not kept]');
      process.stdout.write(tail.data.endsWith('\n') ? tail.data : `${tail.data}\n`);
    }
    return;
  }

  const ctx = await fetchContext(options);
  console.log(options.json ? JSON.stringify(ctx, null, 2) : formatContext(ctx));
}
