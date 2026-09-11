import { apiClient, ApiError } from '../../services/api-client';
import type { LiveAgent } from './agent.adapter';

/**
 * Live Task adapter.
 *
 * Talks to the real backend task, responsibility, dependency and coordinator
 * routes (all under `/projects/:projectId/tasks`, behind `requireAuth`). Uses
 * the shared `apiClient` (cookie session, throws `ApiError` on non-2xx). The
 * creator is derived from the session server-side, so `createTask` never sends
 * a creatorId.
 *
 * Two assignment paths are exposed, and they behave very differently:
 *  - `claimTask` (manual): POST a responsibility. A real failure (already
 *    assigned, agent not in project, file conflict) is a non-2xx `ApiError`
 *    that propagates.
 *  - `autoAssign` (coordinator): POST to `/assign`. The coordinator answers
 *    with HTTP 200 in BOTH the success and the "could not assign" cases, so the
 *    `{ assigned: false, reason }` outcome is a real domain result, never an
 *    error. This adapter returns it as-is; callers must inspect `assigned`.
 *
 * Response envelopes differ across the API: the task list is paginated
 * (`{ items, page, limit, total }`), unlike `/projects` (`{ projects }`) or
 * `/projects/:id/agents` (a bare array).
 */

/** Prisma `TaskStatus`. */
export type LiveTaskStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'PENDING_APPROVAL'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** Prisma `TaskPriority`. */
export type LiveTaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** How a responsibility was created (coordinator assignments only). */
export type AssignmentSource = 'HUMAN_PREFERENCE' | 'CAPABILITY_MATCH';

export interface TaskCreator {
  id: string;
  walletAddress: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskResponsibility {
  id: string;
  taskId: string;
  agentId: string;
  role: string | null;
  assignmentSource?: AssignmentSource | null;
  assignmentExplanation?: unknown;
  createdAt: string;
  agent?: LiveAgent;
}

export interface TaskDependencyRow {
  id: string;
  projectId: string;
  taskId: string;
  dependencyType: string;
  dependsOnTaskId: string | null;
  artifactId: string | null;
  /** Server-computed: true once the upstream task is COMPLETED or the artifact exists. */
  available: boolean;
  createdAt: string;
  dependsOnTask?: { id: string; title: string; status: LiveTaskStatus; priority?: LiveTaskPriority } | null;
  artifact?: { id: string; name: string; type: string; version: number } | null;
}

export interface LiveTask {
  id: string;
  projectId: string;
  creatorId: string;
  preferredAgentId: string | null;
  title: string;
  description: string;
  status: LiveTaskStatus;
  priority: LiveTaskPriority;
  filePaths: string[];
  requiredCapabilities: string[];
  createdAt: string;
  updatedAt: string;
  creator?: TaskCreator;
  responsibilities?: TaskResponsibility[];
  dependencies?: TaskDependencyRow[];
}

export interface TaskListResult {
  items: LiveTask[];
  page: number;
  limit: number;
  total: number;
}

export interface ListTasksQuery {
  status?: LiveTaskStatus;
  priority?: LiveTaskPriority;
  page?: number;
  limit?: number;
}

/** Fields a client may set when creating a task. Creator is server-side only. */
export interface CreateTaskInput {
  title: string;
  description: string;
  priority?: LiveTaskPriority;
  filePaths?: string[];
  preferredAgentId?: string;
  requiredCapabilities?: string[];
}

export interface AssignResponsibilityInput {
  agentId: string;
  role?: string;
}

/** A task can depend on either another task's completion or an artifact, never both. */
export interface CreateDependencyInput {
  dependsOnTaskId?: string;
  artifactId?: string;
  dependencyType?: string;
}

export interface AssignmentExplanation {
  matchedCapabilities?: string[];
  unmatchedCapabilities?: string[];
  categoryScores?: Record<string, number>;
  workload?: number;
  reason?: string;
}

/** The coordinator's reasons for declining to assign (HTTP 200, not an error). */
export type AssignmentFailureReason =
  | 'NO_ELIGIBLE_AGENT'
  | 'PREFERRED_AGENT_UNAVAILABLE'
  | 'PREFERRED_AGENT_UNAUTHORIZED'
  | 'TASK_ALREADY_ASSIGNED'
  | 'TASK_CANCELLED_OR_COMPLETED'
  | 'DEPENDENCIES_NOT_SATISFIED';

export type AssignmentResult =
  | {
      assigned: true;
      taskId: string;
      agentId: string;
      source: AssignmentSource;
      score?: number;
      explanation?: AssignmentExplanation;
    }
  | {
      assigned: false;
      taskId: string;
      reason: AssignmentFailureReason;
    };

export interface TaskAdapter {
  listTasks(projectId: string, query?: ListTasksQuery): Promise<TaskListResult>;
  getTask(projectId: string, taskId: string): Promise<LiveTask>;
  createTask(projectId: string, input: CreateTaskInput): Promise<LiveTask>;
  updateTaskStatus(projectId: string, taskId: string, status: LiveTaskStatus): Promise<LiveTask>;
  claimTask(projectId: string, taskId: string, input: AssignResponsibilityInput): Promise<TaskResponsibility>;
  listResponsibilities(projectId: string, taskId: string): Promise<TaskResponsibility[]>;
  listDependencies(projectId: string, taskId: string): Promise<TaskDependencyRow[]>;
  addDependency(projectId: string, taskId: string, input: CreateDependencyInput): Promise<TaskDependencyRow>;
  removeDependency(projectId: string, taskId: string, dependencyId: string): Promise<void>;
  autoAssign(projectId: string, taskId: string, preferredAgentId?: string): Promise<AssignmentResult>;
}

function base(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/tasks`;
}

export const liveTaskAdapter: TaskAdapter = {
  async listTasks(projectId: string, query: ListTasksQuery = {}): Promise<TaskListResult> {
    const params: Record<string, string | number> = {};
    if (query.status) params.status = query.status;
    if (query.priority) params.priority = query.priority;
    if (query.page !== undefined) params.page = query.page;
    if (query.limit !== undefined) params.limit = query.limit;
    return apiClient.get<TaskListResult>(base(projectId), { params });
  },

  async getTask(projectId: string, taskId: string): Promise<LiveTask> {
    return apiClient.get<LiveTask>(`${base(projectId)}/${encodeURIComponent(taskId)}`);
  },

  async createTask(projectId: string, input: CreateTaskInput): Promise<LiveTask> {
    // Creator is derived from the session server-side; never send creatorId.
    const body: CreateTaskInput = { title: input.title, description: input.description };
    if (input.priority !== undefined) body.priority = input.priority;
    if (input.filePaths !== undefined) body.filePaths = input.filePaths;
    if (input.preferredAgentId !== undefined) body.preferredAgentId = input.preferredAgentId;
    if (input.requiredCapabilities !== undefined) body.requiredCapabilities = input.requiredCapabilities;
    return apiClient.post<LiveTask>(base(projectId), body);
  },

  async updateTaskStatus(projectId: string, taskId: string, status: LiveTaskStatus): Promise<LiveTask> {
    return apiClient.patch<LiveTask>(`${base(projectId)}/${encodeURIComponent(taskId)}`, { status });
  },

  async claimTask(
    projectId: string,
    taskId: string,
    input: AssignResponsibilityInput,
  ): Promise<TaskResponsibility> {
    const body: AssignResponsibilityInput = { agentId: input.agentId };
    if (input.role !== undefined && input.role !== '') body.role = input.role;
    return apiClient.post<TaskResponsibility>(
      `${base(projectId)}/${encodeURIComponent(taskId)}/responsibilities`,
      body,
    );
  },

  async listResponsibilities(projectId: string, taskId: string): Promise<TaskResponsibility[]> {
    return apiClient.get<TaskResponsibility[]>(
      `${base(projectId)}/${encodeURIComponent(taskId)}/responsibilities`,
    );
  },

  async listDependencies(projectId: string, taskId: string): Promise<TaskDependencyRow[]> {
    return apiClient.get<TaskDependencyRow[]>(
      `${base(projectId)}/${encodeURIComponent(taskId)}/dependencies`,
    );
  },

  async addDependency(
    projectId: string,
    taskId: string,
    input: CreateDependencyInput,
  ): Promise<TaskDependencyRow> {
    const body: CreateDependencyInput = {};
    if (input.dependsOnTaskId !== undefined) body.dependsOnTaskId = input.dependsOnTaskId;
    if (input.artifactId !== undefined) body.artifactId = input.artifactId;
    if (input.dependencyType !== undefined) body.dependencyType = input.dependencyType;
    return apiClient.post<TaskDependencyRow>(
      `${base(projectId)}/${encodeURIComponent(taskId)}/dependencies`,
      body,
    );
  },

  async removeDependency(projectId: string, taskId: string, dependencyId: string): Promise<void> {
    await apiClient.delete<void>(
      `${base(projectId)}/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(dependencyId)}`,
    );
  },

  async autoAssign(
    projectId: string,
    taskId: string,
    preferredAgentId?: string,
  ): Promise<AssignmentResult> {
    // The coordinator returns HTTP 200 for both the assigned and the declined
    // outcomes, so `{ assigned: false }` arrives as a normal result here, never
    // as an ApiError. Only transport/auth failures throw.
    const body = preferredAgentId ? { preferredAgentId } : {};
    return apiClient.post<AssignmentResult>(
      `${base(projectId)}/${encodeURIComponent(taskId)}/assign`,
      body,
    );
  },
};

/**
 * Best human-readable message from a thrown error. `apiClient` already picks
 * the most specific text out of the server's error body, most specific first:
 * a Zod failure's per-field `details`, then `message`, then the bare error
 * code, then the HTTP status line. So `ApiError.message` is that text
 * directly; this never needs to reach into `.data` itself, and never invents
 * a message of its own.
 */
export function taskErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Something went wrong';
}

/** True when a claim failed because the task touches files another active task holds. */
export function isFileConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && errorCode(err) === 'FILE_CONFLICT';
}

/** The server error code carried in the ApiError body, if any. */
export function errorCode(err: unknown): string | null {
  if (err instanceof ApiError && err.data && typeof err.data === 'object' && 'error' in err.data) {
    const code = (err.data as { error: unknown }).error;
    return typeof code === 'string' ? code : null;
  }
  return null;
}
