import { apiClient } from '../../services/api-client';

/**
 * Live Project adapter.
 *
 * Talks to the real AgentMesh backend project routes (mounted at `/projects`
 * on the API server, behind `requireAuth`). Uses the shared `apiClient`, which
 * already sends `credentials: 'include'` for the SIWE cookie session and throws
 * an `ApiError` (carrying the HTTP status) on any non-2xx response.
 *
 * There is no error swallowing here on purpose: a 401/403/500/network failure
 * propagates to the caller so the hook and UI can render distinct states. The
 * server owns identity, so `createProject` never sends an ownerId.
 */

/** Owner summary the backend includes on list rows and single-project reads. */
export interface ProjectOwner {
  id: string;
  displayName?: string | null;
  walletAddress?: string | null;
}

/**
 * A project as returned by the API. The list endpoint adds `role`/`joinedAt`
 * (from the membership row) and `owner`; the single-project read additionally
 * includes members and agents, which are not modelled here since PRD-42 only
 * needs list/create/open.
 */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  owner?: ProjectOwner;
  role?: string;
  joinedAt?: string;
}

/** Fields a client may set when creating a project. `ownerId` is server-side only. */
export interface CreateProjectInput {
  name: string;
  description?: string | null;
}

export interface ProjectAdapter {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project>;
  createProject(input: CreateProjectInput): Promise<Project>;
}

/** GET /projects returns the list wrapped in `{ projects }`. */
interface ListProjectsResponse {
  projects: Project[];
}

export const liveProjectAdapter: ProjectAdapter = {
  async listProjects(): Promise<Project[]> {
    const response = await apiClient.get<ListProjectsResponse>('/projects');
    return response.projects;
  },

  async getProject(id: string): Promise<Project> {
    return apiClient.get<Project>(`/projects/${encodeURIComponent(id)}`);
  },

  async createProject(input: CreateProjectInput): Promise<Project> {
    // Identity comes from the session cookie server-side; never send an ownerId.
    const body: CreateProjectInput = { name: input.name };
    if (input.description !== undefined) {
      body.description = input.description;
    }
    return apiClient.post<Project>('/projects', body);
  },
};
