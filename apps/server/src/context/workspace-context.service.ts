import type { WorkspaceContext } from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { NotFoundError } from '../errors/app-error.js';
import { getProjectRole } from '../auth/project-access.js';
import { terminalService } from '../terminals/terminal.service.js';

/**
 * Structured workspace awareness for agents.
 *
 * Answers "what is everyone else doing, where, and does it collide with what I
 * am about to do?" from the database, so an agent can find out before it
 * starts instead of its developer relaying it by hand. Deliberately bounded
 * and metadata-only:
 * - no artifact payloads (fetch an artifact explicitly if you need it),
 * - no terminal output (ask for a SHARED terminal's tail explicitly),
 * - no absolute server paths for worktrees, only agent, task and branch,
 * - terminals limited to SHARED ones plus the requesting user's own.
 */

const ACTIVE_TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'PENDING_APPROVAL', 'BLOCKED'] as const;
const LIMITS = { tasks: 50, artifacts: 20, decisions: 10, worktrees: 20 } as const;

export interface ContextFocus {
  taskId?: string;
  filePaths?: string[];
}

/** `a` and `b` refer to the same file, or one is a directory containing the other. */
export function pathsOverlap(a: string, b: string): boolean {
  const norm = (p: string) => p.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

export class WorkspaceContextService {
  /**
   * Builds the context `agentId` sees. `viewerUserId` is the user the agent
   * acts for (its owner); terminal visibility is decided for that user.
   */
  async buildForAgent(
    projectId: string,
    agentId: string,
    viewerUserId: string,
    focus: ContextFocus = {},
  ): Promise<WorkspaceContext> {
    await getProjectRole(projectId, viewerUserId);

    const [project, self] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } }),
      prisma.agent.findUnique({
        where: { id: agentId },
        include: { capabilities: { select: { capability: true } } },
      }),
    ]);
    if (!project) throw new NotFoundError('Project not found');
    if (!self || self.projectId !== projectId) throw new NotFoundError('Agent not found in this project');

    const [agents, tasks, artifacts, worktrees, decisions, terminals] = await Promise.all([
      prisma.agent.findMany({
        where: { projectId },
        include: {
          owner: { select: { id: true, displayName: true, ensName: true } },
          capabilities: { select: { capability: true } },
          taskResponsibilities: {
            where: { task: { status: { in: [...ACTIVE_TASK_STATUSES] } } },
            include: { task: { select: { id: true, title: true, status: true, filePaths: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.task.findMany({
        where: { projectId, status: { in: [...ACTIVE_TASK_STATUSES] } },
        include: {
          responsibilities: { include: { agent: { select: { id: true, name: true } } } },
          dependencies: {
            include: {
              dependsOnTask: { select: { id: true, title: true, status: true } },
              artifact: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: LIMITS.tasks,
      }),
      prisma.artifact.findMany({
        where: { projectId },
        select: {
          id: true,
          name: true,
          type: true,
          version: true,
          status: true,
          taskId: true,
          createdAt: true,
          agent: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: LIMITS.artifacts,
      }),
      prisma.gitWorktree.findMany({
        where: { status: 'ACTIVE', task: { projectId } },
        select: { id: true, agentId: true, taskId: true, branchName: true, status: true, agent: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: LIMITS.worktrees,
      }),
      prisma.projectBrainEntry.findMany({
        where: { projectId },
        select: { type: true, title: true, content: true },
        orderBy: { createdAt: 'desc' },
        take: LIMITS.decisions,
      }),
      terminalService.listVisible(projectId, viewerUserId),
    ]);

    const taskViews = tasks.map((t) => {
      const dependsOn = t.dependencies.map((d) => {
        const artifactDep = d.dependencyType === 'ARTIFACT_REQUIRED' || d.dependencyType.startsWith('ARTIFACT_REQUIRED:');
        const satisfied = artifactDep
          ? Boolean(d.artifactId && d.artifact)
          : d.dependsOnTask
            ? d.dependsOnTask.status === 'COMPLETED'
            : Boolean(d.artifact);
        return {
          dependencyId: d.id,
          type: d.dependencyType,
          taskId: d.dependsOnTask?.id ?? null,
          taskTitle: d.dependsOnTask?.title ?? null,
          taskStatus: d.dependsOnTask?.status ?? null,
          artifactId: d.artifact?.id ?? null,
          artifactName: d.artifact?.name ?? null,
          satisfied,
        };
      });
      return {
        taskId: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        filePaths: t.filePaths,
        assignedAgents: t.responsibilities.map((r) => ({ agentId: r.agent.id, name: r.agent.name })),
        dependsOn,
        blocked: t.status === 'BLOCKED' || dependsOn.some((d) => !d.satisfied),
        openOffer: Boolean(t.offerExpiresAt) && t.responsibilities.length === 0,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      project: { projectId: project.id, name: project.name },
      self: {
        agentId: self.id,
        name: self.name,
        capabilities: self.capabilities.map((c) => c.capability),
      },
      agents: agents
        .filter((a) => a.id !== agentId)
        .map((a) => ({
          agentId: a.id,
          name: a.name,
          provider: a.provider,
          owner: { userId: a.owner.id, displayName: a.owner.displayName, ensName: a.owner.ensName },
          capabilities: a.capabilities.map((c) => c.capability),
          online: connectionManager.isAgentConnected(projectId, a.id),
          status: a.status,
          currentTasks: a.taskResponsibilities.map((r) => ({
            taskId: r.task.id,
            title: r.task.title,
            status: r.task.status,
            filePaths: r.task.filePaths,
          })),
        })),
      tasks: taskViews,
      artifacts: artifacts.map((a) => ({
        artifactId: a.id,
        name: a.name,
        type: a.type,
        version: a.version,
        status: a.status,
        taskId: a.taskId,
        producedBy: a.agent ? { agentId: a.agent.id, name: a.agent.name } : null,
        createdAt: a.createdAt.toISOString(),
      })),
      worktrees: worktrees.map((w) => ({
        worktreeId: w.id,
        agentId: w.agentId,
        agentName: w.agent.name,
        taskId: w.taskId,
        branch: w.branchName,
        status: w.status,
      })),
      terminals,
      decisions,
      overlaps: this.findOverlaps(agentId, taskViews, focus),
    };
  }

  /**
   * Where this agent's work may collide with another agent's: shared files,
   * the same task held by someone else, or a dependency on work still in
   * someone else's hands. Each comes with a sentence saying why, so an agent
   * (or its human) can decide what to do rather than being silently blocked.
   */
  findOverlaps(
    agentId: string,
    tasks: WorkspaceContext['tasks'],
    focus: ContextFocus,
  ): WorkspaceContext['overlaps'] {
    const mine = tasks.filter((t) => t.assignedAgents.some((a) => a.agentId === agentId));
    const focusTask = focus.taskId ? tasks.find((t) => t.taskId === focus.taskId) : undefined;
    const myPaths = new Set<string>([
      ...mine.flatMap((t) => t.filePaths),
      ...(focusTask?.filePaths ?? []),
      ...(focus.filePaths ?? []),
    ]);
    const myTaskIds = new Set([...mine.map((t) => t.taskId), ...(focusTask ? [focusTask.taskId] : [])]);

    const overlaps: WorkspaceContext['overlaps'] = [];
    for (const task of tasks) {
      const others = task.assignedAgents.filter((a) => a.agentId !== agentId);
      if (others.length === 0) continue;
      const other = others[0];

      if (myTaskIds.has(task.taskId)) {
        overlaps.push({
          kind: 'TASK',
          taskId: task.taskId,
          taskTitle: task.title,
          agentId: other.agentId,
          agentName: other.name,
          filePaths: [],
          explanation: `${other.name} is also assigned to "${task.title}". Coordinate before both of you change it.`,
        });
        continue;
      }

      const shared = task.filePaths.filter((p) => [...myPaths].some((m) => pathsOverlap(p, m)));
      if (shared.length > 0) {
        overlaps.push({
          kind: 'FILE',
          taskId: task.taskId,
          taskTitle: task.title,
          agentId: other.agentId,
          agentName: other.name,
          filePaths: shared,
          explanation: `${other.name} is working on "${task.title}" (${task.status}), which touches ${shared.join(', ')}.`,
        });
      }
    }

    // Work I depend on that is still in another agent's hands is a handoff to
    // wait for, not a collision, but it is exactly what an agent should know.
    for (const task of [...mine, ...(focusTask ? [focusTask] : [])]) {
      for (const dep of task.dependsOn) {
        if (dep.satisfied || !dep.taskId) continue;
        const upstream = tasks.find((t) => t.taskId === dep.taskId);
        const holder = upstream?.assignedAgents.find((a) => a.agentId !== agentId);
        if (!upstream || !holder) continue;
        if (overlaps.some((o) => o.taskId === upstream.taskId)) continue;
        overlaps.push({
          kind: 'TASK',
          taskId: upstream.taskId,
          taskTitle: upstream.title,
          agentId: holder.agentId,
          agentName: holder.name,
          filePaths: [],
          explanation: `"${task.title}" depends on "${upstream.title}", which ${holder.name} has not finished (${upstream.status}).`,
        });
      }
    }
    return overlaps;
  }
}

export const workspaceContextService = new WorkspaceContextService();
