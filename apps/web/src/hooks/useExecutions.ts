import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  liveExecutionAdapter,
  executionErrorMessage,
  type CreateExecutionInput,
  type CreateExecutionResult,
  type LiveExecution,
} from '../adapters/live/execution.adapter';

const POLL_INTERVAL_MS = 2000;

export interface UseExecutionsResult {
  executions: LiveExecution[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createExecution: (input: CreateExecutionInput) => Promise<CreateExecutionResult>;
  cancelExecution: (executionId: string) => Promise<LiveExecution>;
}

/**
 * Loads and manages the real executions for one task.
 *
 * No websocket or delta signal exists for execution progress (confirmed
 * directly against the server), so this hook polls while it holds at least
 * one non-terminal (`QUEUED` or `RUNNING`) execution, and stops once every
 * execution it knows about is terminal. That condition is recomputed from
 * `executions` on every render rather than latched once, so it re-arms on
 * its own the moment a fresh execution appears (a retry after a cancel, a
 * second run) even after polling had already stopped; nothing needs to
 * remember "start polling again."
 *
 * Loading, error, and empty stay distinct, same as every other live hook:
 * a failed load sets `error` and keeps the previous list; a successful empty
 * response is an empty list with no error. `createExecution` and
 * `cancelExecution` refetch on success so the list reflects the real result
 * immediately, and let a genuine transport/auth/validation error propagate.
 * `createExecution` itself never throws for the policy-approval outcome: it
 * resolves with `{ kind: 'approval_required', ... }`, since that is a real
 * 202 success, not an error.
 *
 * Pass `null` for either id when nothing is selected: the hook then holds an
 * empty, non-loading, error-free state and makes no request. Live Mode only.
 */
export function useExecutions(projectId: string | null, taskId: string | null): UseExecutionsResult {
  const [executions, setExecutions] = useState<LiveExecution[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId && taskId));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !taskId) {
      setExecutions([]);
      setError(null);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const result = await liveExecutionAdapter.listExecutions(projectId, taskId, { limit: 50 });
      setExecutions(result.items);
    } catch (err) {
      setError(executionErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId]);

  useEffect(() => {
    setLoading(Boolean(projectId && taskId));
    void load();
  }, [load, projectId, taskId]);

  const hasActiveExecution = useMemo(
    () => executions.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING'),
    [executions],
  );

  useEffect(() => {
    if (!hasActiveExecution) return;
    const timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveExecution, load]);

  const createExecution = useCallback(
    async (input: CreateExecutionInput): Promise<CreateExecutionResult> => {
      if (!projectId || !taskId) throw new Error('No task selected');
      const result = await liveExecutionAdapter.createExecution(projectId, taskId, input);
      await load();
      return result;
    },
    [projectId, taskId, load],
  );

  const cancelExecution = useCallback(
    async (executionId: string): Promise<LiveExecution> => {
      if (!projectId || !taskId) throw new Error('No task selected');
      const cancelled = await liveExecutionAdapter.cancelExecution(projectId, taskId, executionId);
      await load();
      return cancelled;
    },
    [projectId, taskId, load],
  );

  return { executions, loading, error, refetch: load, createExecution, cancelExecution };
}
