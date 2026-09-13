/**
 * Open offers on the shared task board.
 *
 * A human posts work to the board without naming an agent. Every connected
 * agent is told about it, any of them may claim it, and if nobody does within
 * the offer window the coordinator assigns it to an agent that is actually
 * free. The three paths (offer, claim, sweep) all end in the same real
 * TaskResponsibility row the rest of the product already reacts to, so nothing
 * here is a parallel notion of assignment.
 */

import { prisma } from '../lib/prisma.js';
import { taskService } from '../tasks/task.service.js';
import { coordinatorService } from './coordinator.service.js';
import { activityService } from './activity.service.js';
import { deltaSequencerService } from './delta-sequencer.service.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors/app-error.js';

/** Bounds on how long an offer can sit on the board before it is assigned. */
export const MIN_OFFER_SECONDS = 5;
export const MAX_OFFER_SECONDS = 3600;
export const DEFAULT_OFFER_SECONDS = 30;

/**
 * How long to wait before retrying an offer that no agent could take, because
 * every agent was offline or busy. Long enough that an unplaceable offer does
 * not churn the database on every sweep, short enough that an agent coming
 * online picks the work up promptly.
 */
const OFFER_RETRY_MS = 15000;

/**
 * Mirrors the coordinator's requireIdle rule, so the board's "free" badge and
 * the sweeper's choice cannot disagree.
 */
const UNFINISHED_TASK_STATUSES_FOR_OFFERS = new Set<string>([
  'TODO',
  'IN_PROGRESS',
  'PENDING_APPROVAL',
  'BLOCKED',
]);

export interface CreateOfferInput {
  title: string;
  description?: string;
  offerSeconds?: number;
  requiredCapabilities?: string[];
}

export class TaskOfferService {
  /**
   * Post a task to the board as an open offer.
   *
   * The task is created through the ordinary task service, so membership
   * checks, deltas and the task.created activity all behave exactly as they do
   * for any other task. The only addition is the deadline and the offer
   * announcement that agents listen for.
   */
  async createOffer(projectId: string, userId: string, input: CreateOfferInput) {
    const title = input.title.trim();
    if (!title) {
      throw new BadRequestError('A task needs a title');
    }

    const seconds = input.offerSeconds ?? DEFAULT_OFFER_SECONDS;
    if (!Number.isFinite(seconds) || seconds < MIN_OFFER_SECONDS || seconds > MAX_OFFER_SECONDS) {
      throw new BadRequestError(
        `offerSeconds must be between ${MIN_OFFER_SECONDS} and ${MAX_OFFER_SECONDS}`,
      );
    }

    const created = await taskService.createTask(projectId, userId, {
      title,
      // The task schema requires a description; fall back to the title rather
      // than forcing the board's single-line input to collect two fields.
      description: input.description?.trim() || title,
      priority: 'MEDIUM',
      filePaths: [],
      ...(input.requiredCapabilities?.length
        ? { requiredCapabilities: input.requiredCapabilities }
        : {}),
    });

    const offerExpiresAt = new Date(Date.now() + seconds * 1000);
    const task = await prisma.task.update({
      where: { id: created.id },
      data: { offerExpiresAt },
    });

    await this.announce(projectId, {
      type: 'task.offered',
      taskId: task.id,
      actorId: userId,
      actorType: 'human',
      message: `Open for any agent to claim: ${task.title}`,
      offerExpiresAt,
    });

    return task;
  }

  /**
   * An agent takes an open offer for itself.
   *
   * First claim wins: the unique constraint on (taskId, agentId) plus the
   * "already has a responsibility" check mean two agents racing cannot both
   * end up owning the task. The loser gets a conflict, not a silent no-op, so
   * its CLI can say what happened.
   */
  async claimOffer(projectId: string, taskId: string, agentId: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { responsibilities: true },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, projectId: true, ownerId: true },
    });

    if (!agent || agent.projectId !== projectId) {
      throw new NotFoundError('Agent not found in this project');
    }

    if (task.responsibilities.length > 0) {
      const owner = task.responsibilities[0];
      throw new ConflictError(
        owner.agentId === agentId
          ? 'This agent has already claimed that task'
          : 'Another agent has already taken that task',
      );
    }

    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw new ConflictError('That task is no longer open');
    }

    // Claiming goes through the same assignment path a human assignment uses,
    // so file-conflict checks and the taskResponsibility delta are identical.
    const responsibility = await taskService.assignResponsibilityAsSystem(
      projectId,
      taskId,
      agentId,
      'SELF_CLAIMED',
    );

    await this.closeOffer(projectId, taskId);

    await this.announce(projectId, {
      type: 'task.claimed',
      taskId,
      actorId: agentId,
      actorType: 'agent',
      actorName: agent.name,
      message: `${agent.name} claimed: ${task.title}`,
    });

    return responsibility;
  }

  /**
   * Assign every offer whose window has closed.
   *
   * Returns what it did, so the caller (and tests) can see the outcome rather
   * than having to infer it. An offer the coordinator cannot place, because no
   * agent is online and free, keeps its deadline and is retried on the next
   * pass: the work stays visible on the board instead of vanishing.
   */
  async sweepDueOffers(now: Date = new Date()): Promise<
    Array<{ taskId: string; assignedAgentId?: string; reason?: string }>
  > {
    const due = await prisma.task.findMany({
      where: {
        offerExpiresAt: { lte: now },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        responsibilities: { none: {} },
      },
      select: { id: true, projectId: true, creatorId: true, title: true },
      // Bounded so one sweep cannot stall on a huge backlog.
      take: 50,
    });

    const results: Array<{ taskId: string; assignedAgentId?: string; reason?: string }> = [];

    for (const task of due) {
      try {
        const outcome = await coordinatorService.assignTask(
          task.projectId,
          task.id,
          task.creatorId,
          // requireIdle: an agent still holding an unstarted task is not free,
          // even though the ordinary assignment flow tolerates that. Among
          // agents that are genuinely idle and equally suited, spread the work
          // around instead of always picking the oldest.
          { tieBreak: 'random', requireIdle: true },
        );

        if (outcome.assigned) {
          await this.closeOffer(task.projectId, task.id);
          const agent = await prisma.agent.findUnique({
            where: { id: outcome.agentId },
            select: { name: true },
          });
          await this.announce(task.projectId, {
            type: 'task.auto_assigned',
            taskId: task.id,
            actorId: outcome.agentId,
            actorType: 'agent',
            actorName: agent?.name,
            message: `No agent claimed it, so ${agent?.name ?? 'an agent'} was auto assigned: ${task.title}`,
          });
          results.push({ taskId: task.id, assignedAgentId: outcome.agentId });
        } else {
          // Nobody free to take it. Push the deadline out instead of retrying
          // every few seconds: the task stays on the board with a running
          // countdown, which is what tells the room it is still waiting, and
          // the activity feed is not filled with the same line forever.
          await this.deferOffer(task.projectId, task.id);
          results.push({ taskId: task.id, reason: outcome.reason });
        }
      } catch (err) {
        console.error(`[offers] could not place task ${task.id}:`, err);
        results.push({ taskId: task.id, reason: 'SWEEP_FAILED' });
      }
    }

    return results;
  }

  /**
   * Push an unplaceable offer's deadline out so it is retried later rather
   * than on every single sweep.
   */
  private async deferOffer(projectId: string, taskId: string): Promise<void> {
    const offerExpiresAt = new Date(Date.now() + OFFER_RETRY_MS);
    await prisma.task.update({ where: { id: taskId }, data: { offerExpiresAt } });
    await deltaSequencerService.recordAndBroadcastDelta(projectId, [
      {
        entity: 'task',
        entityId: taskId,
        operation: 'updated',
        fields: { offerExpiresAt: offerExpiresAt.toISOString() },
      },
    ]);
  }

  /** Take a task off the board without deleting it. */
  private async closeOffer(projectId: string, taskId: string): Promise<void> {
    await prisma.task.update({ where: { id: taskId }, data: { offerExpiresAt: null } });
    await deltaSequencerService.recordAndBroadcastDelta(projectId, [
      { entity: 'task', entityId: taskId, operation: 'updated', fields: { offerExpiresAt: null } },
    ]);
  }

  /**
   * Tell the whole project, agents included.
   *
   * Deltas only reach browser clients, so the activity record is what actually
   * reaches connected agents. That is the mechanism by which "every agent is
   * asked" is true rather than decorative.
   */
  private async announce(
    projectId: string,
    input: {
      type: string;
      taskId: string;
      actorId: string;
      actorType: 'human' | 'agent' | 'system';
      actorName?: string;
      message: string;
      offerExpiresAt?: Date;
    },
  ): Promise<void> {
    try {
      await activityService.recordActivity(projectId, {
        type: input.type,
        actorType: input.actorType,
        actorId: input.actorId,
        actorName: input.actorName,
        taskId: input.taskId,
        message: input.message,
        payload: input.offerExpiresAt
          ? { offerExpiresAt: input.offerExpiresAt.toISOString() }
          : undefined,
      });
    } catch (err) {
      // The assignment is already committed; a failed announcement must not
      // undo it or fail the request that caused it.
      console.error(`[offers] announcement failed for task ${input.taskId}:`, err);
    }

    await deltaSequencerService.recordAndBroadcastDelta(projectId, [
      {
        entity: 'task',
        entityId: input.taskId,
        operation: 'updated',
        fields: {
          offerExpiresAt: input.offerExpiresAt?.toISOString() ?? null,
        },
      },
    ]);
  }

  /**
   * The board's own view of who could take an offer right now, so the UI can
   * say "3 agents free" instead of guessing.
   */
  async listAvailableAgents(projectId: string, userId: string) {
    await taskService.verifyMembership(projectId, userId);

    const agents = await prisma.agent.findMany({
      where: { projectId, status: 'ONLINE' },
      include: {
        executions: { where: { status: { in: ['RUNNING', 'QUEUED'] } }, select: { id: true } },
        taskResponsibilities: { include: { task: { select: { status: true } } } },
      },
    });

    // "busy" here must mean the same thing the sweeper means by it, or the
    // board would show an agent as free and then not pick it.
    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      busy:
        agent.executions.length > 0 ||
        agent.taskResponsibilities.some(
          (r) => !!r.task && UNFINISHED_TASK_STATUSES_FOR_OFFERS.has(r.task.status),
        ),
    }));
  }
}

export const taskOfferService = new TaskOfferService();

/**
 * Drive the sweep on a timer.
 *
 * Returned as a stop function rather than started implicitly, so tests and a
 * shutting-down server can turn it off; without that an interval would keep
 * the process alive and keep writing to the database between tests.
 */
export function startOfferSweeper(intervalMs = 5000): () => void {
  const timer = setInterval(() => {
    void taskOfferService.sweepDueOffers().catch((err) => {
      console.error('[offers] sweep failed:', err);
    });
  }, intervalMs);

  // Do not hold the event loop open on account of the sweeper alone.
  timer.unref?.();

  return () => clearInterval(timer);
}
