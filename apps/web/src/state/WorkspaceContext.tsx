import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProjectDTO } from '@agentmesh/shared';
import { api } from '../lib/api';
import { useAuth, AuthUser } from '../hooks/useAuth';

const ACTIVE_PROJECT_KEY = 'agentmesh.activeProjectId';

export interface WorkspaceState {
  /** Authentication state (wired to the real SIWE backend). */
  user: AuthUser | null;
  authStatus: ReturnType<typeof useAuth>['status'];
  authError: string | null;
  connectWallet: ReturnType<typeof useAuth>['connectWallet'];
  loginWithSiwe: ReturnType<typeof useAuth>['loginWithSiwe'];
  logout: ReturnType<typeof useAuth>['logout'];

  projects: ProjectDTO[];
  projectsLoading: boolean;
  projectsError: string | null;

  activeProjectId: string | null;
  activeProject: ProjectDTO | null;

  refreshProjects: () => Promise<void>;
  createProject: (name: string, description?: string) => Promise<ProjectDTO>;
  selectProject: (projectId: string) => void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { user } = auth;

  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_PROJECT_KEY) : null,
  );

  const refreshProjects = useCallback(async () => {
    if (!user) return;
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const res = await api.listProjects();
      setProjects(res.projects);
      // Drop a stale active project id (e.g. after a project was deleted).
      setActiveProjectId((current) => {
        if (current && !res.projects.some((p) => p.id === current)) {
          window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
          return null;
        }
        return current;
      });
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setProjectsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const createProject = useCallback(
    async (name: string, description?: string) => {
      if (!user) throw new Error('Not authenticated');
      const project = await api.createProject({
        name,
        description: description ?? null,
        ownerId: user.id,
      });
      setProjects((prev) => [project, ...prev]);
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
      setActiveProjectId(project.id);
      return project;
    },
    [user],
  );

  const selectProject = useCallback((projectId: string) => {
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    setActiveProjectId(projectId);
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const value: WorkspaceState = {
    user: auth.user,
    authStatus: auth.status,
    authError: auth.error,
    connectWallet: auth.connectWallet,
    loginWithSiwe: auth.loginWithSiwe,
    logout: auth.logout,
    projects,
    projectsLoading,
    projectsError,
    activeProjectId,
    activeProject,
    refreshProjects,
    createProject,
    selectProject,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  }
  return ctx;
}