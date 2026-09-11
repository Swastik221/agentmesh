import { apiClient, ApiError } from '../../services/api-client';
import type { LiveAgent } from './agent.adapter';
import type { LiveTask } from './task.adapter';

/**
 * Live Execution adapter.
 *
 * Talks to the real backend execution routes, all under
 * `/projects/:projectId/tasks/:taskId/executions`, behind `requireAuth`. An
 * execution is a distinct action from assignment (PRD-44): the server only
 * accepts `createExecution` for an agent that already holds a
 * `TaskResponsibility` for the task, and assignment never creates an
 * execution on its own.
 *
 * `createExecution` can resolve three genuinely different ways, and only one
 * of them is a thrown `ApiError`:
 *  - 201: the execution was created (`QUEUED`). The background pipeline then
 *    runs unattended (no websocket or delta signal exists for it, confirmed
 *    directly against the server: callers must poll to see it progress).
 *  - 202: the project's policy requires human approval for `task.execute`.
 *    This is a genuine HTTP success (`response.ok`), so `apiClient` never
 *    throws for it; no `TaskExecution` row exists yet. Distinguished from a
 *    real execution purely by body shape (an `approvalRequestId` field, which
 *    a `TaskExecution` never has), not by status code, since a successful
 *    response's status is not otherwise exposed to the caller.
 *  - a real 4xx: missing responsibility, dependencies not satisfied, policy
 *    deny, agent/task not found. A normal `ApiError`, message already correct
 *    per `apiClient`'s own precedence (Zod field details > message > code).
 */

export type LiveExecutionStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface LiveExecution {
  id: string;
  taskId: string;
  agentId: string;
  status: LiveExecutionStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on create, get and cancel; absent from the list envelope. */
  agent?: LiveAgent;
  task?: LiveTask;
}

export interface ExecutionListResult {
  items: LiveExecution[];
  page: number;
  limit: number;
  total: number;
}

export interface ListExecutionsQuery {
  page?: number;
  limit?: number;
}

export interface CreateExecutionInput {
  agentId: string;
  input?: Record<string, unknown> | null;
}

export type CreateExecutionResult =
  | { kind: 'created'; execution: LiveExecution }
  | { kind: 'approval_required'; approvalRequestId: string; approvalRequest: unknown; message: string };

/** The 202 body shape for a policy-gated execution. Never has execution fields. */
interface ApprovalPendingBody {
  approvalRequestId: string;
  approvalRequest: unknown;
  message?: unknown;
}

function isApprovalPending(value: unknown): value is ApprovalPendingBody {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { approvalRequestId?: unknown }).approvalRequestId === 'string'
  );
}

export interface ExecutionAdapter {
  listExecutions(
    projectId: string,
    taskId: string,
    query?: ListExecutionsQuery,
  ): Promise<ExecutionListResult>;
  getExecution(projectId: string, taskId: string, executionId: string): Promise<LiveExecution>;
  createExecution(
    projectId: string,
    taskId: string,
    input: CreateExecutionInput,
  ): Promise<CreateExecutionResult>;
  cancelExecution(projectId: string, taskId: string, executionId: string): Promise<LiveExecution>;
}

function base(projectId: string, taskId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/executions`;
}

export const liveExecutionAdapter: ExecutionAdapter = {
  async listExecutions(
    projectId: string,
    taskId: string,
    query: ListExecutionsQuery = {},
  ): Promise<ExecutionListResult> {
    const params: Record<string, string | number> = {};
    if (query.page !== undefined) params.page = query.page;
    if (query.limit !== undefined) params.limit = query.limit;
    return apiClient.get<ExecutionListResult>(base(projectId, taskId), { params });
  },

  async getExecution(projectId: string, taskId: string, executionId: string): Promise<LiveExecution> {
    return apiClient.get<LiveExecution>(`${base(projectId, taskId)}/${encodeURIComponent(executionId)}`);
  },

  async createExecution(
    projectId: string,
    taskId: string,
    input: CreateExecutionInput,
  ): Promise<CreateExecutionResult> {
    const body: CreateExecutionInput = { agentId: input.agentId };
    if (input.input !== undefined) body.input = input.input;
    const result = await apiClient.post<LiveExecution | ApprovalPendingBody>(
      base(projectId, taskId),
      body,
    );
    if (isApprovalPending(result)) {
      return {
        kind: 'approval_required',
        approvalRequestId: result.approvalRequestId,
        approvalRequest: result.approvalRequest,
        message: typeof result.message === 'string' ? result.message : 'Execution requires human approval.',
      };
    }
    return { kind: 'created', execution: result };
  },

  async cancelExecution(projectId: string, taskId: string, executionId: string): Promise<LiveExecution> {
    return apiClient.post<LiveExecution>(
      `${base(projectId, taskId)}/${encodeURIComponent(executionId)}/cancel`,
    );
  },
};

/** Best human-readable message from a thrown error. `apiClient` already picks it. */
export function executionErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Something went wrong';
}
