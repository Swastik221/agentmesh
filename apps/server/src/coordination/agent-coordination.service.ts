import { randomUUID } from 'node:crypto';
import { Prisma, type AgentMessage } from '@prisma/client';
import {
  CoordinationMessageType,
  PROTOCOL_VERSION,
  AGENT_MESSAGE_MAX_DATA_BYTES,
  handoffNoteSchema,
  type AgentIntent,
  type AgentMessageView,
  type HandoffNote,
  type HandoffView,
} from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { connectionManager } from '../websocket/connection.manager.js';
import type { ConnectionMetadata } from '../websocket/websocket.types.js';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors/app-error.js';

/**
 * Structured agent-to-agent coordination.
 *
 * The older `agent.message` is a live, fire-and-forget chat line between two
 * connected agents. This is the durable layer on top: every message has an
 * intent (ASK, ANSWER, HANDOFF, ...), is stored per recipient with a delivery
 * state, survives the recipient being offline (it is delivered when they next
 * connect), is deduplicated by the sender's envelope id, and is recorded as
 * workspace activity so the humans can see what their agents agreed.
 *
 * Nothing here lets one agent act on another's machine or approve anything on
 * a human's behalf: messages carry information, and handoffs are artifacts
 * that go through the project's normal artifact policy and review.
 */

type AgentConn = ConnectionMetadata & { agentId: string; userId: string };

const ACTIVE_STATUSES = ['TODO', 'IN_PROGRESS', 'PENDING_APPROVAL', 'BLOCKED'] as const;
const HANDOFF_ARTIFACT_TYPE = 'handoff';

export interface SendInput {
  recipientAgentId?: string;
  taskId?: string;
  intent: AgentIntent;
  subject: string;
  body: string;
  data?: Record<string, unknown>;
  inReplyTo?: string;
}

function frame(projectId: string, type: string, payload: unknown, recipientId?: string): string {
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

/** Connections that should hear about messages and context: executors and observers, not terminals. */
function listeningConnections(agentId: string): ConnectionMetadata[] {
  return connectionManager
    .getAllConnections()
    .filter(
      (c) =>
        c.authenticated &&
        c.agentId === agentId &&
        c.connectionRole !== 'terminal' &&
        c.socket.readyState === c.socket.OPEN,
    );
}

export class AgentCoordinationService {
  // ------------------------------------------------------------- messages

  /**
   * Stores a message for each recipient and delivers it to whoever is
   * connected. `clientMessageId` (the sender's envelope id) makes a resend a
   * no-op.
   */
  async send(conn: AgentConn, input: SendInput, clientMessageId: string): Promise<{ messageIds: string[]; delivered: number; queued: number }> {
    if (input.data !== undefined) {
      const size = Buffer.byteLength(JSON.stringify(input.data), 'utf8');
      if (size > AGENT_MESSAGE_MAX_DATA_BYTES) {
        throw new BadRequestError(`Message data is ${size} bytes; the limit is ${AGENT_MESSAGE_MAX_DATA_BYTES}`);
      }
    }

    if (input.taskId) {
      const task = await prisma.task.findUnique({ where: { id: input.taskId }, select: { projectId: true } });
      if (!task || task.projectId !== conn.projectId) throw new NotFoundError('Task not found in this project');
    }

    let recipients: string[];
    if (input.recipientAgentId) {
      const recipient = await prisma.agent.findUnique({ where: { id: input.recipientAgentId }, select: { projectId: true } });
      if (!recipient || recipient.projectId !== conn.projectId) {
        throw new NotFoundError('Recipient agent not found in this project');
      }
      recipients = [input.recipientAgentId];
    } else {
      const assigned = await prisma.taskResponsibility.findMany({
        where: { taskId: input.taskId! },
        select: { agentId: true },
      });
      recipients = assigned.map((a) => a.agentId);
    }
    recipients = [...new Set(recipients)].filter((id) => id !== conn.agentId);
    if (recipients.length === 0) {
      throw new BadRequestError('Nobody to send to: the task has no other agents assigned');
    }

    let inReplyTo: AgentMessage | null = null;
    if (input.inReplyTo) {
      inReplyTo = await prisma.agentMessage.findUnique({ where: { id: input.inReplyTo } });
      if (
        !inReplyTo ||
        inReplyTo.projectId !== conn.projectId ||
        (inReplyTo.recipientAgentId !== conn.agentId && inReplyTo.senderAgentId !== conn.agentId)
      ) {
        throw new NotFoundError('The message being replied to was not found');
      }
    }

    await prisma.agentMessage.createMany({
      data: recipients.map((recipientAgentId) => ({
        projectId: conn.projectId,
        senderAgentId: conn.agentId,
        recipientAgentId,
        taskId: input.taskId ?? null,
        intent: input.intent,
        subject: input.subject,
        body: input.body,
        data: (input.data as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        inReplyToId: inReplyTo?.id ?? null,
        clientMessageId,
      })),
      skipDuplicates: true,
    });

    const rows = await prisma.agentMessage.findMany({
      where: { senderAgentId: conn.agentId, clientMessageId, recipientAgentId: { in: recipients } },
      include: { sender: { select: { id: true, name: true } } },
    });

    let delivered = 0;
    for (const row of rows) {
      if (row.deliveryState === 'PENDING' && (await this.deliver(row))) delivered += 1;
      else if (row.deliveryState !== 'PENDING') delivered += 1;
    }

    // Answering or acknowledging a message closes it.
    if (inReplyTo && (input.intent === 'ANSWER' || input.intent === 'ACKNOWLEDGE') && inReplyTo.recipientAgentId === conn.agentId) {
      await prisma.agentMessage.updateMany({
        where: { id: inReplyTo.id, deliveryState: { not: 'ACKNOWLEDGED' } },
        data: { deliveryState: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
      });
    }

    await this.recordActivity(conn, rows, input);
    return { messageIds: rows.map((r) => r.id), delivered, queued: rows.length - delivered };
  }

  /** Pushes a stored message to its recipient's live connections. */
  private async deliver(row: AgentMessage & { sender: { id: string; name: string } }): Promise<boolean> {
    const conns = listeningConnections(row.recipientAgentId);
    if (conns.length === 0) return false;
    const data = frame(row.projectId, CoordinationMessageType.AGENT_COORDINATE_DELIVERY, this.view(row), row.recipientAgentId);
    for (const c of conns) c.socket.send(data);
    await prisma.agentMessage.updateMany({
      where: { id: row.id, deliveryState: 'PENDING' },
      data: { deliveryState: 'DELIVERED', deliveredAt: new Date() },
    });
    return true;
  }

  /** On (re)connect: hand an agent everything that was queued while it was away. */
  async deliverPending(conn: ConnectionMetadata): Promise<number> {
    if (!conn.authenticated || !conn.agentId || conn.connectionRole === 'terminal') return 0;
    const pending = await prisma.agentMessage.findMany({
      where: { recipientAgentId: conn.agentId, projectId: conn.projectId, deliveryState: 'PENDING' },
      include: { sender: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    let count = 0;
    for (const row of pending) {
      if (await this.deliver(row)) count += 1;
    }
    return count;
  }

  async acknowledge(conn: AgentConn, messageId: string): Promise<void> {
    const row = await prisma.agentMessage.findUnique({ where: { id: messageId } });
    if (!row || row.recipientAgentId !== conn.agentId || row.projectId !== conn.projectId) {
      throw new NotFoundError('Message not found');
    }
    await prisma.agentMessage.updateMany({
      where: { id: messageId, deliveryState: { not: 'ACKNOWLEDGED' } },
      data: { deliveryState: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    });
  }

  /** Messages to this agent, newest first. Reading the inbox does not acknowledge them. */
  async inbox(conn: AgentConn, includeAcknowledged = false, limit = 50): Promise<AgentMessageView[]> {
    const rows = await prisma.agentMessage.findMany({
      where: {
        recipientAgentId: conn.agentId,
        projectId: conn.projectId,
        ...(!includeAcknowledged && { deliveryState: { not: 'ACKNOWLEDGED' } }),
      },
      include: { sender: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    // Anything read here has reached the agent, even if it was queued.
    const queued = rows.filter((r) => r.deliveryState === 'PENDING').map((r) => r.id);
    if (queued.length) {
      await prisma.agentMessage.updateMany({
        where: { id: { in: queued } },
        data: { deliveryState: 'DELIVERED', deliveredAt: new Date() },
      });
    }
    return rows.map((r) => this.view({ ...r, deliveryState: r.deliveryState === 'PENDING' ? 'DELIVERED' : r.deliveryState }));
  }

  async pendingCount(agentId: string, projectId: string): Promise<number> {
    return prisma.agentMessage.count({
      where: { recipientAgentId: agentId, projectId, deliveryState: { not: 'ACKNOWLEDGED' } },
    });
  }

  private view(row: AgentMessage & { sender: { id: string; name: string } }): AgentMessageView {
    return {
      messageId: row.id,
      intent: row.intent,
      from: { agentId: row.sender.id, name: row.sender.name },
      recipientAgentId: row.recipientAgentId,
      taskId: row.taskId,
      subject: row.subject,
      body: row.body,
      data: (row.data as Record<string, unknown> | null) ?? null,
      inReplyTo: row.inReplyToId,
      deliveryState: row.deliveryState,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async recordActivity(conn: AgentConn, rows: Array<AgentMessage & { sender: { name: string } }>, input: SendInput): Promise<void> {
    if (rows.length === 0) return;
    try {
      const names = await prisma.agent.findMany({
        where: { id: { in: rows.map((r) => r.recipientAgentId) } },
        select: { name: true },
      });
      const { activityService } = await import('../services/activity.service.js');
      await activityService.recordActivity(conn.projectId, {
        type: 'agent.coordination',
        actorType: 'agent',
        actorId: conn.agentId,
        actorName: rows[0].sender.name,
        taskId: input.taskId,
        message: `${rows[0].sender.name} → ${names.map((n) => n.name).join(', ')} [${input.intent}] ${input.subject}`,
        payload: { messageIds: rows.map((r) => r.id), intent: input.intent },
      });
    } catch (err) {
      logger.error('[Coordination] Failed to record activity:', err);
    }
  }

  // ------------------------------------------------------------- handoffs

  /**
   * Publishes a handoff note as a `handoff` artifact on the task. It goes
   * through the normal artifact policy (which may require human approval),
   * then every agent whose task depends on this one is sent a HANDOFF message
   * and a context-changed notice.
   */
  async publishHandoff(
    conn: AgentConn,
    input: { taskId: string; name?: string; note: HandoffNote; recipientAgentId?: string },
    clientMessageId: string,
  ): Promise<{ artifactId: string; status: string; notified: number }> {
    const task = await prisma.task.findUnique({ where: { id: input.taskId }, select: { id: true, projectId: true, title: true } });
    if (!task || task.projectId !== conn.projectId) throw new NotFoundError('Task not found in this project');

    const { artifactService } = await import('../services/artifact.service.js');
    const artifact = await artifactService.createArtifact(conn.projectId, task.id, conn.userId, {
      type: HANDOFF_ARTIFACT_TYPE,
      name: input.name ?? `Handoff: ${task.title}`.slice(0, 200),
      payload: input.note,
      agentId: conn.agentId,
      requiresReview: false,
    });

    const dependents = await this.agentsOnDependentTasks(conn.projectId, task.id);
    const recipients = new Set(dependents);
    if (input.recipientAgentId) recipients.add(input.recipientAgentId);
    recipients.delete(conn.agentId);

    let notified = 0;
    for (const recipientAgentId of recipients) {
      try {
        await this.send(
          conn,
          {
            recipientAgentId,
            taskId: task.id,
            intent: 'HANDOFF',
            subject: `Handoff on "${task.title}"`,
            body: input.note.summary,
            data: { artifactId: artifact.id },
          },
          `${clientMessageId}:handoff`,
        );
        notified += 1;
      } catch (err) {
        logger.error('[Coordination] Handoff notification failed:', err);
      }
    }
    this.notifyContextChanged(conn.projectId, [...recipients], {
      reason: 'HANDOFF',
      summary: `A handoff note was published on "${task.title}"`,
      taskId: task.id,
      artifactId: artifact.id,
    });
    return { artifactId: artifact.id, status: artifact.status, notified };
  }

  /**
   * Handoff notes relevant to an agent: those on tasks its tasks depend on,
   * then the most recent in the project. Only notes that still parse as a
   * handoff are returned.
   */
  async handoffsFor(projectId: string, agentId: string, limit = 10): Promise<HandoffView[]> {
    const mine = await prisma.taskResponsibility.findMany({
      where: { agentId, task: { projectId, status: { in: [...ACTIVE_STATUSES] } } },
      select: { taskId: true },
    });
    const upstream = await prisma.taskDependency.findMany({
      where: { taskId: { in: mine.map((m) => m.taskId) }, dependsOnTaskId: { not: null } },
      select: { dependsOnTaskId: true },
    });
    const upstreamIds = upstream.map((u) => u.dependsOnTaskId!).filter(Boolean);

    const [relevant, recent] = await Promise.all([
      upstreamIds.length
        ? prisma.artifact.findMany({
            where: { projectId, type: HANDOFF_ARTIFACT_TYPE, taskId: { in: upstreamIds } },
            include: { task: { select: { title: true } }, agent: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
        : Promise.resolve([]),
      prisma.artifact.findMany({
        where: { projectId, type: HANDOFF_ARTIFACT_TYPE },
        include: { task: { select: { title: true } }, agent: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const seen = new Set<string>();
    const out: HandoffView[] = [];
    for (const a of [...relevant, ...recent]) {
      if (seen.has(a.id) || out.length >= limit) continue;
      seen.add(a.id);
      const note = handoffNoteSchema.safeParse(a.payload);
      if (!note.success) continue;
      out.push({
        artifactId: a.id,
        taskId: a.taskId,
        taskTitle: a.task.title,
        from: a.agent ? { agentId: a.agent.id, name: a.agent.name } : null,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
        note: note.data,
      });
    }
    return out;
  }

  // ---------------------------------------------------------- agent tools

  async artifactDetails(conn: AgentConn, artifactId: string): Promise<Record<string, unknown>> {
    const a = await prisma.artifact.findUnique({
      where: { id: artifactId },
      include: { agent: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
    });
    if (!a || a.projectId !== conn.projectId) throw new NotFoundError('Artifact not found');
    return {
      artifactId: a.id,
      name: a.name,
      type: a.type,
      version: a.version,
      status: a.status,
      task: { taskId: a.task.id, title: a.task.title },
      producedBy: a.agent ? { agentId: a.agent.id, name: a.agent.name } : null,
      payload: a.payload,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private async requireAssigned(conn: AgentConn, taskId: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { responsibilities: { select: { agentId: true } } },
    });
    if (!task || task.projectId !== conn.projectId) throw new NotFoundError('Task not found in this project');
    if (!task.responsibilities.some((r) => r.agentId === conn.agentId)) {
      throw new ForbiddenError('This agent is not assigned to that task');
    }
    return task;
  }

  /**
   * An agent moves one of its own tasks between TODO, IN_PROGRESS and BLOCKED.
   * Completion is not offered: finishing goes through execution results,
   * artifacts and human review, never an agent's say-so.
   */
  async updateOwnTaskStatus(conn: AgentConn, taskId: string, status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED', reason?: string): Promise<string> {
    const task = await this.requireAssigned(conn, taskId);
    const { taskService } = await import('../tasks/task.service.js');
    const updated = await taskService.updateTask(conn.projectId, taskId, conn.userId, { status });
    if (status === 'BLOCKED') {
      const agent = await prisma.agent.findUnique({ where: { id: conn.agentId }, select: { name: true } });
      const { activityService } = await import('../services/activity.service.js');
      await activityService
        .recordActivity(conn.projectId, {
          type: 'task.blocked',
          actorType: 'agent',
          actorId: conn.agentId,
          actorName: agent?.name,
          taskId,
          message: `${agent?.name ?? 'An agent'} is blocked on "${task.title}"${reason ? `: ${reason}` : ''}`,
        })
        .catch(() => {});
      this.notifyContextChanged(conn.projectId, await this.agentsOnDependentTasks(conn.projectId, taskId), {
        reason: 'TASK_BLOCKED',
        summary: `"${task.title}" is blocked${reason ? `: ${reason}` : ''}`,
        taskId,
      });
    }
    return updated.status;
  }

  /**
   * Records the files an agent is touching for one of its tasks, so overlap
   * detection sees them. If they collide with another agent's in-progress
   * work the files are still reported back with the overlaps (and the other
   * agents told), but the task is not changed: resolving that is a human or
   * agent decision, not something to paper over.
   */
  async reportFileActivity(
    conn: AgentConn,
    taskId: string,
    filePaths: string[],
  ): Promise<{ filePaths: string[]; overlaps: Array<Record<string, unknown>> }> {
    const task = await this.requireAssigned(conn, taskId);
    const merged = [...new Set([...task.filePaths, ...filePaths])];
    const { taskService } = await import('../tasks/task.service.js');
    try {
      await taskService.updateTask(conn.projectId, taskId, conn.userId, { filePaths: merged });
    } catch (err) {
      // A collision with in-progress work is reported, not forced through.
      if (!(err instanceof ConflictError) && !(err instanceof AppError && err.code === 'FILE_CONFLICT')) throw err;
    }

    const { workspaceContextService } = await import('../context/workspace-context.service.js');
    const ctx = await workspaceContextService.buildForAgent(conn.projectId, conn.agentId, conn.userId, { taskId, filePaths });
    const overlaps = ctx.overlaps.filter((o) => o.kind === 'FILE');
    const others = [...new Set(overlaps.map((o) => o.agentId).filter((id): id is string => Boolean(id)))];
    if (others.length) {
      this.notifyContextChanged(conn.projectId, others, {
        reason: 'CONFLICT',
        summary: `Another agent reported working on ${filePaths.join(', ')} for "${task.title}"`,
        taskId,
      });
    }
    return { filePaths: merged, overlaps };
  }

  // -------------------------------------------------------- notifications

  /** Agents assigned to active tasks that depend on `taskId`. */
  async agentsOnDependentTasks(projectId: string, taskId: string): Promise<string[]> {
    const deps = await prisma.taskDependency.findMany({
      where: { projectId, dependsOnTaskId: taskId, task: { status: { in: [...ACTIVE_STATUSES] } } },
      select: { task: { select: { responsibilities: { select: { agentId: true } } } } },
    });
    return [...new Set(deps.flatMap((d) => d.task.responsibilities.map((r) => r.agentId)))];
  }

  /**
   * Tells only the given agents that something affecting their work changed.
   * Best effort and fire-and-forget: an agent that is not connected picks it
   * up from its context next time it asks.
   */
  notifyContextChanged(
    projectId: string,
    agentIds: string[],
    payload: { reason: string; summary: string; taskId?: string; artifactId?: string; agentId?: string },
  ): void {
    for (const agentId of new Set(agentIds)) {
      const data = frame(projectId, CoordinationMessageType.WORKSPACE_CONTEXT_CHANGED, payload, agentId);
      for (const c of listeningConnections(agentId)) {
        if (c.projectId === projectId) c.socket.send(data);
      }
    }
  }

  /** After an agent's executor disconnects: tell agents waiting on its work. */
  async onAgentDisconnected(projectId: string, agentId: string): Promise<void> {
    const active = await prisma.taskResponsibility.findMany({
      where: { agentId, task: { projectId, status: { in: [...ACTIVE_STATUSES] } } },
      select: { taskId: true, task: { select: { title: true } }, agent: { select: { name: true } } },
    });
    for (const r of active) {
      const waiting = (await this.agentsOnDependentTasks(projectId, r.taskId)).filter((id) => id !== agentId);
      this.notifyContextChanged(projectId, waiting, {
        reason: 'AGENT_DISCONNECTED',
        summary: `${r.agent.name} disconnected while holding "${r.task.title}", which your work depends on`,
        taskId: r.taskId,
        agentId,
      });
    }
  }

  /** After an assignment: tell the assignee, and flag file overlaps to both sides. */
  async onTaskAssigned(projectId: string, taskId: string, agentId: string): Promise<void> {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true, filePaths: true } });
    if (!task) return;
    this.notifyContextChanged(projectId, [agentId], {
      reason: 'TASK_ASSIGNED',
      summary: `You were assigned "${task.title}"`,
      taskId,
    });
    if (task.filePaths.length === 0) return;
    const { pathsOverlap } = await import('../context/workspace-context.service.js');
    const others = await prisma.taskResponsibility.findMany({
      where: { agentId: { not: agentId }, task: { projectId, id: { not: taskId }, status: { in: [...ACTIVE_STATUSES] } } },
      select: { agentId: true, task: { select: { title: true, filePaths: true } } },
    });
    const colliding = others.filter((o) => o.task.filePaths.some((p) => task.filePaths.some((q) => pathsOverlap(p, q))));
    if (colliding.length) {
      this.notifyContextChanged(projectId, [agentId, ...colliding.map((c) => c.agentId)], {
        reason: 'CONFLICT',
        summary: `"${task.title}" touches files that ${colliding.map((c) => `"${c.task.title}"`).join(', ')} also touches`,
        taskId,
      });
    }
  }

  /** After an agent publishes an artifact: tell agents on tasks that depend on it. */
  async onArtifactPublished(projectId: string, taskId: string, artifactId: string, producerAgentId: string): Promise<void> {
    const waiting = (await this.agentsOnDependentTasks(projectId, taskId)).filter((id) => id !== producerAgentId);
    if (!waiting.length) return;
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
    this.notifyContextChanged(projectId, waiting, {
      reason: 'ARTIFACT_PUBLISHED',
      summary: `A new artifact was published on "${task?.title ?? 'a task'}", which your work depends on`,
      taskId,
      artifactId,
    });
  }
}

export const agentCoordinationService = new AgentCoordinationService();
