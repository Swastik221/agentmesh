import { useCallback, useEffect, useState } from 'react';
import {
  liveTaskAdapter,
  taskErrorMessage,
  type AssignmentResult,
  type CreateDependencyInput,
  type CreateOfferInput,
  type CreateTaskInput,
  type LiveTask,
  type OfferCandidate,
  type LiveTaskStatus,
  type LiveTaskPriority,
  type TaskDependencyRow,
  type TaskResponsibility,
} from '../adapters/live/task.adapter';
import { ApiError } from '../services/api-client';
import { recoverFromStaleProject } from '../utils/projectSelection';

export interface UseTasksQuery {
  status?: LiveTaskStatus;
  priority?: LiveTaskPriority;
}

export interface UseTasksResult {
  tasks: LiveTask[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<LiveTask>;
  /** Post work to the board open to any agent, with an auto assign deadline. */
  createOffer: (input: CreateOfferInput) => Promise<LiveTask>;
  /** Hand an open offer to one agent immediately. */
  claimOffer: (taskId: string, agentId: string) => Promise<TaskResponsibility>;
  /** Agents that could take an offer right now, with their busy state. */
  listOfferCandidates: () => Promise<OfferCandidate[]>;
  /** Manual claim: a human assigns a specific agent (responsibility). */
  claimTask: (taskId: string, agentId: string, role?: string) => Promise<TaskResponsibility>;
  /** Coordinator auto-assign. Resolves with the domain result (may be `assigned: false`). */
  autoAssign: (taskId: string, preferredAgentId?: string) => Promise<AssignmentResult>;
  /** Declares that a task depends on another task's completion, or on an artifact. */
  addDependency: (taskId: string, input: CreateDependencyInput) => Promise<TaskDependencyRow>;
  /** Direct status change (e.g. marking a task COMPLETED unblocks its dependents). */
  updateStatus: (taskId: string, status: LiveTaskStatus) => Promise<LiveTask>;
}

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
 * Automatically triggers project recovery on 404 Project Not Found errors.
 */
export function useTasks(projectId: string | null, query: UseTasksQuery = {}): UseTasksResult {
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);

  const { status, priority } = query;

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
      const items = await liveTaskAdapter.listAllTasks(projectId, { status, priority });
      setTasks(await withResolvedDependencies(projectId, items));
    } catch (err) {
      setError(taskErrorMessage(err));
      if (err instanceof ApiError && err.status === 404 && projectId) {
        void recoverFromStaleProject(projectId);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, status, priority]);

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

  const createOffer = useCallback(
    async (input: CreateOfferInput): Promise<LiveTask> => {
      if (!projectId) throw new Error('No project selected');
      const created = await liveTaskAdapter.createOffer(projectId, input);
      await load();
      return created;
    },
    [projectId, load],
  );

  const claimOffer = useCallback(
    async (taskId: string, agentId: string): Promise<TaskResponsibility> => {
      if (!projectId) throw new Error('No project selected');
      const responsibility = await liveTaskAdapter.claimOffer(projectId, taskId, agentId);
      await load();
      return responsibility;
    },
    [projectId, load],
  );

  const listOfferCandidates = useCallback(async (): Promise<OfferCandidate[]> => {
    if (!projectId) return [];
    return liveTaskAdapter.listOfferCandidates(projectId);
  }, [projectId]);

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
    createOffer,
    claimOffer,
    listOfferCandidates,
    autoAssign,
    addDependency,
    updateStatus,
  };
}
