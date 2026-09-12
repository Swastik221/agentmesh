import { useCallback, useEffect, useState } from 'react';
import {
  liveProjectAdapter,
  type CreateProjectInput,
  type Project,
} from '../adapters/live/project.adapter';

export interface UseProjectsResult {
  projects: Project[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
}

/**
 * Loads and manages the authenticated user's real projects from the backend.
 *
 * Loading, error, and empty are kept as distinct states: a failed request sets
 * `error` and leaves the previous list untouched (a 500 is never flattened into
 * "no projects"), while a successful empty response is an empty list with no
 * error. `createProject` refetches on success so the new project shows up, and
 * lets the underlying error propagate so callers can surface the real server
 * validation message.
 *
 * This hook fetches real backend projects for the authenticated user.
 */
export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await liveProjectAdapter.listProjects();
      setProjects(list);
    } catch (err) {
      // Surface a real error state; do not collapse it into an empty list.
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createProject = useCallback(
    async (input: CreateProjectInput): Promise<Project> => {
      const created = await liveProjectAdapter.createProject(input);
      await load();
      return created;
    },
    [load],
  );

  return { projects, loading, error, refetch: load, createProject };
}
