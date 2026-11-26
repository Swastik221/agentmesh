import { randomUUID } from 'node:crypto';
import { Prisma, TerminalSession, TerminalSessionStatus, TerminalVisibility } from '@prisma/client';
import {
  CoordinationMessageType,
  PROTOCOL_VERSION,
  redactSecrets,
  type TerminalSessionSummary,
} from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { connectionManager } from '../websocket/connection.manager.js';
import type { ConnectionMetadata } from '../websocket/websocket.types.js';
import { ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { getProjectRole } from '../auth/project-access.js';

/**
 * Connected terminal sessions.
 *
 * The terminal itself runs on the developer's machine; the server is a relay
 * with a policy. Privacy is enforced here, never left to clients:
 *
 * - Only the connection that opened a session may write output to it, and
 *   nothing may write input: remote control is deliberately not supported.
 * - Output reaches the session's owner, plus project members while the
 *   session is SHARED. Making it PRIVATE again revokes every other viewer at
 *   once.
 * - Output is never written to the database. It lives in a bounded per-session
 *   buffer so a late viewer sees recent context, and that buffer is dropped
 *   when the session closes or has been disconnected for a while.
 * - Output is redacted for common secret formats before buffering (the CLI
 *   redacts too). Best effort; see @agentmesh/agent-protocol redaction.ts.
 */

/** Recent output kept per session for late viewers. */
export const TERMINAL_BUFFER_BYTES = 64 * 1024;
/** Per-session forwarding budget; a runaway process must not flood viewers. */
export const TERMINAL_RATE_BYTES_PER_SEC = 256 * 1024;
/** How long a disconnected session's buffer is kept for a reconnect. */
export const TERMINAL_DISCONNECTED_BUFFER_TTL_MS = 10 * 60 * 1000;
/** Throttle for persisting lastActiveAt. */
const LAST_ACTIVE_WRITE_INTERVAL_MS = 30 * 1000;

interface LiveTerminal {
  terminalId: string;
  projectId: string;
  ownerUserId: string;
  visibility: TerminalVisibility;
  chunks: string[];
  bytes: number;
  truncated: boolean;
  seq: number;
  ownerConnectionId: string | null;
  subscribers: Set<string>;
  windowStart: number;
  windowBytes: number;
  droppedNotice: boolean;
  lastActiveWrite: number;
  purgeTimer: NodeJS.Timeout | null;
}

type SessionWithRelations = TerminalSession & {
  owner: { id: string; displayName: string | null };
  agent: { id: string; name: string } | null;
};

const sessionInclude = {
  owner: { select: { id: true, displayName: true } },
  agent: { select: { id: true, name: true } },
} as const;

export function toSessionSummary(s: SessionWithRelations): TerminalSessionSummary {
  return {
    terminalId: s.id,
    projectId: s.projectId,
    name: s.name,
    command: s.command,
    cwd: s.cwd,
    visibility: s.visibility,
    status: s.status,
    owner: { userId: s.owner.id, displayName: s.owner.displayName },
    agent: s.agent ? { agentId: s.agent.id, name: s.agent.name } : null,
    cols: s.cols,
    rows: s.rows,
    lastActiveAt: s.lastActiveAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
  };
}

function envelope(projectId: string, type: string, payload: unknown, recipientId?: string) {
  return JSON.stringify({
    id: randomUUID(),
    protocolVersion: PROTOCOL_VERSION,
    projectId,
    senderId: 'server',
    ...(recipientId && { recipientId }),
    timestamp: new Date().toISOString(),
    type,
    payload,
  });
}

function send(conn: ConnectionMetadata | undefined, data: string): void {
  if (conn && conn.socket.readyState === conn.socket.OPEN) {
    conn.socket.send(data);
  }
}

export interface OpenTerminalInput {
  terminalId?: string;
  name: string;
  command?: string;
  cwd?: string;
  visibility: TerminalVisibility;
  cols?: number;
  rows?: number;
}

export class TerminalService {
  private live = new Map<string, LiveTerminal>();

  // ---------------------------------------------------------------- access

  /**
   * Whether `userId` may read a session's output. The owner always may; anyone
   * else only while it is SHARED and they are a member of its project.
   */
  async canView(session: Pick<TerminalSession, 'projectId' | 'ownerUserId' | 'visibility'>, userId: string): Promise<boolean> {
    if (session.ownerUserId === userId) return true;
    if (session.visibility !== 'SHARED') return false;
    try {
      await getProjectRole(session.projectId, userId);
      return true;
    } catch {
      return false;
    }
  }

  private async loadSession(terminalId: string): Promise<SessionWithRelations | null> {
    return prisma.terminalSession.findUnique({ where: { id: terminalId }, include: sessionInclude });
  }

  /**
   * Loads a session for a viewer, answering "not found" for sessions the
   * viewer may not see so that private sessions cannot be probed for.
   */
  private async loadViewable(terminalId: string, projectId: string, userId: string): Promise<SessionWithRelations> {
    const session = await this.loadSession(terminalId);
    if (!session || session.projectId !== projectId || !(await this.canView(session, userId))) {
      throw new NotFoundError('Terminal session not found');
    }
    return session;
  }

  private async loadOwned(terminalId: string, projectId: string, userId: string): Promise<SessionWithRelations> {
    const session = await this.loadViewable(terminalId, projectId, userId);
    if (session.ownerUserId !== userId) {
      throw new ForbiddenError('Only the owner of a terminal session can change it');
    }
    return session;
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Registers a new session, or resumes one this agent opened before a
   * reconnect. Called for an authenticated agent connection.
   */
  async open(conn: ConnectionMetadata, input: OpenTerminalInput): Promise<{ session: SessionWithRelations; resumed: boolean }> {
    if (!conn.authenticated || !conn.agentId || !conn.userId) {
      throw new ForbiddenError('Only an authenticated agent connection can open a terminal session');
    }

    let session: SessionWithRelations | null = null;
    let resumed = false;

    if (input.terminalId) {
      const existing = await this.loadSession(input.terminalId);
      if (
        existing &&
        existing.projectId === conn.projectId &&
        existing.ownerUserId === conn.userId &&
        existing.agentId === conn.agentId &&
        existing.status !== 'CLOSED'
      ) {
        session = await prisma.terminalSession.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            lastActiveAt: new Date(),
            ...(input.cols && { cols: input.cols }),
            ...(input.rows && { rows: input.rows }),
          },
          include: sessionInclude,
        });
        resumed = true;
      }
      // Anything else (someone else's id, a closed session) silently becomes a
      // new session: a client can never attach to a session it does not own.
    }

    if (!session) {
      // Session metadata is shown to viewers like output is, and a command
      // line is a classic place for a secret (`--api-key ...`), so it gets
      // the same redaction.
      const clean = (v: string | undefined) => (v === undefined ? null : redactSecrets(v).text);
      session = await prisma.terminalSession.create({
        data: {
          projectId: conn.projectId,
          ownerUserId: conn.userId,
          agentId: conn.agentId,
          name: clean(input.name) ?? 'terminal',
          command: clean(input.command),
          cwd: clean(input.cwd),
          visibility: input.visibility,
          cols: input.cols ?? null,
          rows: input.rows ?? null,
        },
        include: sessionInclude,
      });
    }

    const live = this.ensureLive(session);
    if (live.ownerConnectionId && live.ownerConnectionId !== conn.connectionId) {
      // A newer connection for the same session wins; the old one is stale.
      connectionManager.getConnection(live.ownerConnectionId)?.ownedTerminalIds?.delete(session.id);
    }
    live.ownerConnectionId = conn.connectionId;
    if (live.purgeTimer) {
      clearTimeout(live.purgeTimer);
      live.purgeTimer = null;
    }
    conn.ownedTerminalIds ??= new Set();
    conn.ownedTerminalIds.add(session.id);

    this.broadcastSessionChanged(session);
    if (session.visibility === 'SHARED' && !resumed) {
      await this.audit(session, 'terminal.shared', `${session.owner.displayName ?? 'A teammate'} shared terminal "${session.name}" (read-only)`);
    }
    return { session, resumed };
  }

  /** Accepts a chunk of output from the connection that owns the session. */
  async output(conn: ConnectionMetadata, terminalId: string, data: string): Promise<void> {
    const live = this.live.get(terminalId);
    if (!live || live.ownerConnectionId !== conn.connectionId || !conn.ownedTerminalIds?.has(terminalId)) {
      throw new ForbiddenError('This connection does not own that terminal session');
    }
    if (!data) return;

    const now = Date.now();
    if (now - live.windowStart >= 1000) {
      live.windowStart = now;
      live.windowBytes = 0;
      live.droppedNotice = false;
    }
    const size = Buffer.byteLength(data, 'utf8');
    if (live.windowBytes + size > TERMINAL_RATE_BYTES_PER_SEC) {
      if (!live.droppedNotice) {
        live.droppedNotice = true;
        this.append(live, '\r\n[agentmesh: output rate limit reached, some output was not shared]\r\n');
      }
      return;
    }
    live.windowBytes += size;

    this.append(live, redactSecrets(data).text);

    if (now - live.lastActiveWrite > LAST_ACTIVE_WRITE_INTERVAL_MS) {
      live.lastActiveWrite = now;
      void prisma.terminalSession
        .update({ where: { id: terminalId }, data: { lastActiveAt: new Date() } })
        .catch(() => {});
    }
  }

  private append(live: LiveTerminal, text: string): void {
    live.seq += 1;
    live.chunks.push(text);
    live.bytes += Buffer.byteLength(text, 'utf8');
    while (live.bytes > TERMINAL_BUFFER_BYTES && live.chunks.length > 1) {
      const dropped = live.chunks.shift()!;
      live.bytes -= Buffer.byteLength(dropped, 'utf8');
      live.truncated = true;
    }
    const frame = envelope(live.projectId, CoordinationMessageType.TERMINAL_OUTPUT, {
      terminalId: live.terminalId,
      data: text,
      seq: live.seq,
    });
    for (const subscriberId of live.subscribers) {
      const sub = connectionManager.getConnection(subscriberId);
      if (!sub) {
        live.subscribers.delete(subscriberId);
        continue;
      }
      send(sub, frame);
    }
  }

  /**
   * Changes visibility or size. `fromConnectionId` is the owner's own CLI when
   * it initiated the change; otherwise (the web UI) the CLI is told.
   */
  async update(
    projectId: string,
    terminalId: string,
    userId: string,
    change: { visibility?: TerminalVisibility; cols?: number; rows?: number },
    fromConnectionId?: string,
  ): Promise<SessionWithRelations> {
    const before = await this.loadOwned(terminalId, projectId, userId);
    if (before.status === 'CLOSED') {
      throw new NotFoundError('Terminal session not found');
    }

    const session = await prisma.terminalSession.update({
      where: { id: terminalId },
      data: {
        ...(change.visibility && { visibility: change.visibility }),
        ...(change.cols && { cols: change.cols }),
        ...(change.rows && { rows: change.rows }),
      },
      include: sessionInclude,
    });

    const live = this.ensureLive(session);
    live.visibility = session.visibility;

    const visibilityChanged = change.visibility && change.visibility !== before.visibility;
    if (visibilityChanged && session.visibility === 'PRIVATE') {
      this.revokeNonOwners(live, 'UNSHARED');
    }

    // The audience that could see it before or can see it now must learn of
    // the change, so a session going private disappears from teammates' lists.
    this.broadcastSessionChanged(session, before.visibility === 'SHARED');

    if (fromConnectionId !== live.ownerConnectionId && live.ownerConnectionId) {
      send(
        connectionManager.getConnection(live.ownerConnectionId),
        envelope(projectId, CoordinationMessageType.TERMINAL_UPDATE, {
          terminalId,
          visibility: session.visibility,
        }),
      );
    }

    if (visibilityChanged) {
      const who = session.owner.displayName ?? 'A teammate';
      await this.audit(
        session,
        session.visibility === 'SHARED' ? 'terminal.shared' : 'terminal.unshared',
        session.visibility === 'SHARED'
          ? `${who} shared terminal "${session.name}" (read-only)`
          : `${who} stopped sharing terminal "${session.name}"`,
      );
    }
    return session;
  }

  /** Ends a session: by the owner's CLI when it exits, or from the UI. */
  async close(projectId: string, terminalId: string, userId: string, fromConnectionId?: string): Promise<SessionWithRelations> {
    const before = await this.loadOwned(terminalId, projectId, userId);
    const session = await prisma.terminalSession.update({
      where: { id: terminalId },
      data: { status: 'CLOSED', closedAt: new Date() },
      include: sessionInclude,
    });

    const live = this.live.get(terminalId);
    if (live) {
      if (live.ownerConnectionId && live.ownerConnectionId !== fromConnectionId) {
        send(
          connectionManager.getConnection(live.ownerConnectionId),
          envelope(projectId, CoordinationMessageType.TERMINAL_CLOSE, { terminalId }),
        );
      }
      if (live.ownerConnectionId) {
        connectionManager.getConnection(live.ownerConnectionId)?.ownedTerminalIds?.delete(terminalId);
      }
      this.revokeAll(live, 'CLOSED');
      this.drop(terminalId);
    }

    this.broadcastSessionChanged(session, before.visibility === 'SHARED');
    if (before.visibility === 'SHARED') {
      await this.audit(session, 'terminal.closed', `Terminal "${session.name}" was disconnected`);
    }
    return session;
  }

  // --------------------------------------------------------------- viewing

  /** Starts streaming a session to a browser viewer. */
  async subscribe(conn: ConnectionMetadata, terminalId: string): Promise<void> {
    if (!conn.authenticated || !conn.userId || conn.agentId) {
      throw new ForbiddenError('Only a signed-in workspace viewer can watch a terminal');
    }
    const session = await this.loadViewable(terminalId, conn.projectId, conn.userId);
    if (session.status === 'CLOSED') {
      throw new NotFoundError('Terminal session not found');
    }
    const live = this.ensureLive(session);
    live.subscribers.add(conn.connectionId);
    conn.subscribedTerminalIds ??= new Set();
    conn.subscribedTerminalIds.add(terminalId);

    send(
      conn,
      envelope(conn.projectId, CoordinationMessageType.TERMINAL_SNAPSHOT, {
        terminalId,
        data: live.chunks.join(''),
        seq: live.seq,
        truncated: live.truncated,
        session: toSessionSummary(session),
      }),
    );
  }

  unsubscribe(conn: ConnectionMetadata, terminalId: string): void {
    this.live.get(terminalId)?.subscribers.delete(conn.connectionId);
    conn.subscribedTerminalIds?.delete(terminalId);
  }

  /** Recent redacted output, for an agent or REST caller allowed to see it. */
  async tail(projectId: string, terminalId: string, userId: string, maxBytes = 16 * 1024): Promise<{ data: string; truncated: boolean }> {
    await this.loadViewable(terminalId, projectId, userId);
    const live = this.live.get(terminalId);
    if (!live) return { data: '', truncated: false };
    const all = live.chunks.join('');
    const buf = Buffer.from(all, 'utf8');
    if (buf.byteLength <= maxBytes) return { data: all, truncated: live.truncated };
    return { data: buf.subarray(buf.byteLength - maxBytes).toString('utf8'), truncated: true };
  }

  /** Sessions `userId` may see in a project: their own, plus shared ones. */
  async listVisible(projectId: string, userId: string, includeClosed = false): Promise<TerminalSessionSummary[]> {
    await getProjectRole(projectId, userId);
    const sessions = await prisma.terminalSession.findMany({
      where: {
        projectId,
        OR: [{ ownerUserId: userId }, { visibility: 'SHARED' }],
        ...(!includeClosed && { status: { not: TerminalSessionStatus.CLOSED } }),
      },
      include: sessionInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return sessions.map(toSessionSummary);
  }

  // ------------------------------------------------------------- teardown

  /** Called when any WebSocket closes. */
  async onConnectionClosed(conn: ConnectionMetadata): Promise<void> {
    for (const terminalId of conn.subscribedTerminalIds ?? []) {
      this.live.get(terminalId)?.subscribers.delete(conn.connectionId);
    }
    for (const terminalId of conn.ownedTerminalIds ?? []) {
      const live = this.live.get(terminalId);
      if (!live || live.ownerConnectionId !== conn.connectionId) continue;
      live.ownerConnectionId = null;
      try {
        const session = await prisma.terminalSession.update({
          where: { id: terminalId },
          data: { status: 'DISCONNECTED' },
          include: sessionInclude,
        });
        this.broadcastSessionChanged(session);
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
          logger.error('[Terminal] Failed to mark session disconnected:', err);
        }
      }
      live.purgeTimer = setTimeout(() => this.drop(terminalId), TERMINAL_DISCONNECTED_BUFFER_TTL_MS);
      live.purgeTimer.unref?.();
    }
  }

  /**
   * After a restart no terminal can still be connected, so anything recorded
   * as ACTIVE is really DISCONNECTED; its CLI will resume it on reconnect.
   */
  async reconcileOnStartup(): Promise<number> {
    const result = await prisma.terminalSession.updateMany({
      where: { status: 'ACTIVE' },
      data: { status: 'DISCONNECTED' },
    });
    return result.count;
  }

  /** Test helper: forget all in-memory state. */
  reset(): void {
    for (const live of this.live.values()) {
      if (live.purgeTimer) clearTimeout(live.purgeTimer);
    }
    this.live.clear();
  }

  // -------------------------------------------------------------- internals

  private ensureLive(session: TerminalSession): LiveTerminal {
    let live = this.live.get(session.id);
    if (!live) {
      live = {
        terminalId: session.id,
        projectId: session.projectId,
        ownerUserId: session.ownerUserId,
        visibility: session.visibility,
        chunks: [],
        bytes: 0,
        truncated: false,
        seq: 0,
        ownerConnectionId: null,
        subscribers: new Set(),
        windowStart: 0,
        windowBytes: 0,
        droppedNotice: false,
        lastActiveWrite: Date.now(),
        purgeTimer: null,
      };
      this.live.set(session.id, live);
    }
    live.visibility = session.visibility;
    return live;
  }

  private drop(terminalId: string): void {
    const live = this.live.get(terminalId);
    if (live?.purgeTimer) clearTimeout(live.purgeTimer);
    this.live.delete(terminalId);
  }

  private revokeNonOwners(live: LiveTerminal, reason: 'UNSHARED' | 'ACCESS_LOST'): void {
    for (const subscriberId of [...live.subscribers]) {
      const sub = connectionManager.getConnection(subscriberId);
      if (sub && sub.userId === live.ownerUserId) continue;
      live.subscribers.delete(subscriberId);
      sub?.subscribedTerminalIds?.delete(live.terminalId);
      send(sub, envelope(live.projectId, CoordinationMessageType.TERMINAL_REVOKED, { terminalId: live.terminalId, reason }));
    }
  }

  private revokeAll(live: LiveTerminal, reason: 'CLOSED'): void {
    for (const subscriberId of live.subscribers) {
      const sub = connectionManager.getConnection(subscriberId);
      sub?.subscribedTerminalIds?.delete(live.terminalId);
      send(sub, envelope(live.projectId, CoordinationMessageType.TERMINAL_REVOKED, { terminalId: live.terminalId, reason }));
    }
    live.subscribers.clear();
  }

  /**
   * Tells everyone allowed to know about a session that it changed: always its
   * owner's browser tabs; everyone in the project when it is (or, with
   * `wasShared`, just was) shared.
   */
  private broadcastSessionChanged(session: SessionWithRelations, wasShared = false): void {
    const frame = envelope(session.projectId, CoordinationMessageType.TERMINAL_SESSION_CHANGED, {
      session: toSessionSummary(session),
    });
    const toEveryone = session.visibility === 'SHARED' || wasShared;
    for (const conn of connectionManager.getProjectConnections(session.projectId)) {
      if (!conn.authenticated) continue;
      if (toEveryone || conn.userId === session.ownerUserId) {
        send(conn, frame);
      }
    }
  }

  private async audit(session: SessionWithRelations, type: string, message: string): Promise<void> {
    try {
      const { activityService } = await import('../services/activity.service.js');
      await activityService.recordActivity(session.projectId, {
        type,
        actorType: 'human',
        actorId: session.ownerUserId,
        actorName: session.owner.displayName ?? undefined,
        message,
        payload: { terminalId: session.id, agentId: session.agentId },
      });
    } catch (err) {
      logger.error('[Terminal] Failed to record activity:', err);
    }
  }
}

export const terminalService = new TerminalService();
