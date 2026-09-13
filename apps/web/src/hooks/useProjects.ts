import { useCallback, useEffect, useState } from 'react';
import {
  liveProjectAdapter,
  type CreateProjectInput,
  type Project,
} from '../adapters/live/project.adapter';
import { currentProjectId } from '../utils/currentProjectId';
import { resolveProjectSelection } from '../utils/projectSelection';
import { authSessionService } from '../services/auth-session';
import { navigate } from '../routes/AppRouter';

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
 * Automatically resolves and validates candidate project selection:
 * - If a candidate project ID (from URL or storage) is stale/nonexistent,
 *   clears it and selects a valid project or redirects away.
 * - Keeps valid project persistence per authenticated user.
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

      const userId = authSessionService.getCurrentUser()?.id ?? null;
      const candidateId = currentProjectId();
      const resolution = resolveProjectSelection(list, candidateId, userId);

      if (resolution.shouldNavigate) {
        if (resolution.selectedProjectId) {
          navigate(`/workspace/${resolution.selectedProjectId}`);
        } else if (typeof window !== 'undefined' && window.location.pathname.startsWith('/workspace/')) {
          navigate('/workspaces');
        }
      }
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
