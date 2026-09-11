import { useCallback, useEffect, useState } from 'react';
import {
  liveTaskAdapter,
  taskErrorMessage,
  type AssignmentResult,
  type CreateDependencyInput,
  type CreateTaskInput,
  type LiveTask,
  type LiveTaskStatus,
  type ListTasksQuery,
  type TaskDependencyRow,
  type TaskResponsibility,
} from '../adapters/live/task.adapter';

export interface UseTasksResult {
  tasks: LiveTask[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<LiveTask>;
  /** Manual claim: a human assigns a specific agent (responsibility). */
  claimTask: (taskId: string, agentId: string, role?: string) => Promise<TaskResponsibility>;
  /** Coordinator auto-assign. Resolves with the domain result (may be `assigned: false`). */
  autoAssign: (taskId: string, preferredAgentId?: string) => Promise<AssignmentResult>;
  /** Declares that a task depends on another task's completion, or on an artifact. */
  addDependency: (taskId: string, input: CreateDependencyInput) => Promise<TaskDependencyRow>;
  /** Direct status change (e.g. marking a task COMPLETED unblocks its dependents). */
  updateStatus: (taskId: string, status: LiveTaskStatus) => Promise<LiveTask>;
}

/**
 * `GET /projects/:id/tasks` embeds each task's dependencies via a bare Prisma
 * relation include: the raw columns only, with no `available` flag and no
 * `dependsOnTask`/`artifact`. Only the dedicated
 * `GET .../tasks/:taskId/dependencies` endpoint computes those (real value,
 * not a default): confirmed directly against the running server, where the
 * list endpoint's row for a satisfied dependency still carried no `available`
 * field at all, while the dedicated endpoint reported `available: true` for
 * the identical row once its upstream task completed. Left alone, every task
 * with a dependency would read as permanently blocked, even after the
 * coordinator itself had already assigned it.
 *
 * So for every task the list returned with at least one dependency, re-fetch
 * that task's dependencies from the dedicated endpoint and use the computed
 * rows instead. A task with no dependencies never makes the extra call. If a
 * single task's fetch fails, that task keeps its raw (always-looks-blocked)
 * rows rather than failing the whole board load.
 */
async function withResolvedDependencies(projectId: string, tasks: LiveTask[]): Promise<LiveTask[]> {
  const needsResolution = tasks.filter((task) => (task.dependencies?.length ?? 0) > 0);
  if (needsResolution.length === 0) return tasks;

  const resolved = await Promise.all(
    needsResolution.map(async (task) => {
      try {
        return [task.id, await liveTaskAdapter.listDependencies(projectId, task.id)] as const;
      } catch {
        return [task.id, null] as const;
      }
    }),
  );
  const byTaskId = new Map(resolved.filter(([, rows]) => rows !== null) as Array<[string, TaskDependencyRow[]]>);

  return tasks.map((task) => (byTaskId.has(task.id) ? { ...task, dependencies: byTaskId.get(task.id) } : task));
}

/**
 * Loads and manages the real tasks on a project's shared board.
 *
 * Loading, error, and empty stay distinct: a failed load sets `error` and keeps
 * the previous list (a 500 is never flattened into "no tasks"); a successful
 * empty response is an empty list with no error. `createTask` and `claimTask`
 * refetch on success and let the real server error propagate so callers can
 * surface the exact message (already-assigned, file conflict, validation).
 *
 * `autoAssign` also refetches, but its `{ assigned: false }` outcome is a real
 * coordinator result, not an error, so it resolves normally; callers inspect
 * `result.assigned` and only a transport/auth failure rejects.
 *
 * `addDependency` and `updateStatus` refetch on success too, same as
 * `createTask`/`claimTask`: a declared dependency or a status change (e.g.
 * marking a task COMPLETED) can change what the coordinator will do with
 * other tasks on the board, so the list needs to reflect that immediately.
 *
 * Pass `null` for `projectId` when no project is selected: the hook then holds
 * an empty, non-loading, error-free state and makes no request. Live Mode only.
 */
export function useTasks(projectId: string | null, query: ListTasksQuery = {}): UseTasksResult {
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);

  const { status, priority, page, limit } = query;

  const load = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await liveTaskAdapter.listTasks(projectId, { status, priority, page, limit });
      setTasks(await withResolvedDependencies(projectId, result.items));
    } catch (err) {
      setError(taskErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, status, priority, page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTask = useCallback(
    async (input: CreateTaskInput): Promise<LiveTask> => {
      if (!projectId) throw new Error('No project selected');
      const created = await liveTaskAdapter.createTask(projectId, input);
      await load();
      return created;
    },
    [projectId, load],
  );

  const claimTask = useCallback(
    async (taskId: string, agentId: string, role?: string): Promise<TaskResponsibility> => {
      if (!projectId) throw new Error('No project selected');
      const responsibility = await liveTaskAdapter.claimTask(projectId, taskId, { agentId, role });
      await load();
      return responsibility;
    },
    [projectId, load],
  );

  const autoAssign = useCallback(
    async (taskId: string, preferredAgentId?: string): Promise<AssignmentResult> => {
      if (!projectId) throw new Error('No project selected');
      const result = await liveTaskAdapter.autoAssign(projectId, taskId, preferredAgentId);
      await load();
      return result;
    },
    [projectId, load],
  );

  const addDependency = useCallback(
    async (taskId: string, input: CreateDependencyInput): Promise<TaskDependencyRow> => {
      if (!projectId) throw new Error('No project selected');
      const dependency = await liveTaskAdapter.addDependency(projectId, taskId, input);
      await load();
      return dependency;
    },
    [projectId, load],
  );

  const updateStatus = useCallback(
    async (taskId: string, status: LiveTaskStatus): Promise<LiveTask> => {
      if (!projectId) throw new Error('No project selected');
      const updated = await liveTaskAdapter.updateTaskStatus(projectId, taskId, status);
      await load();
      return updated;
    },
    [projectId, load],
  );

  return {
    tasks,
    loading,
    error,
    refetch: load,
    createTask,
    claimTask,
    autoAssign,
    addDependency,
    updateStatus,
  };
}
