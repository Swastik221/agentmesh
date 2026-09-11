import { useCallback, useEffect, useState } from 'react';
import {
  liveAgentAdapter,
  type CreateAgentInput,
  type LiveAgent,
} from '../adapters/live/agent.adapter';

export interface UseAgentsResult {
  agents: LiveAgent[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createAgent: (input: CreateAgentInput) => Promise<LiveAgent>;
}

/**
 * Loads and manages the real agents registered in a project.
 *
 * Loading, error, and empty are distinct: a failed request sets `error` and
 * keeps the previous list (a 500 is never flattened into "no agents"); a
 * successful empty response is an empty list with no error. `createAgent`
 * refetches on success and lets the underlying error propagate so callers can
 * surface the real server message.
 *
 * Pass `null` for `projectId` when no project is selected: the hook then holds
 * an empty, non-loading, error-free state and makes no request. Live Mode only.
 */
export function useAgents(projectId: string | null): UseAgentsResult {
  const [agents, setAgents] = useState<LiveAgent[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setAgents([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await liveAgentAdapter.listAgents(projectId);
      setAgents(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createAgent = useCallback(
    async (input: CreateAgentInput): Promise<LiveAgent> => {
      if (!projectId) {
        throw new Error('No project selected');
      }
      const created = await liveAgentAdapter.createAgent(projectId, input);
      await load();
      return created;
    },
    [projectId, load],
  );

  return { agents, loading, error, refetch: load, createAgent };
}
