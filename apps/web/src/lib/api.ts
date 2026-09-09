import type {
  AgentDTO,
  CreateAgentDTO,
  ProjectDTO,
  TaskDTO,
  TaskListResponseDTO,
  CreateTaskInput,
  UpdateTaskInput,
  UserDTO,
} from '@agentmesh/shared';

/**
 * Typed REST client for the AgentMesh backend. All requests go through the
 * Vite dev proxy (`/api` -> server), so credentials are same-origin and no
 * CORS configuration is needed in development.
 */

const API_BASE = '/api';

/** Server `createProjectSchema` input: name + optional description + ownerId. */
export interface CreateProjectInput {
  name: string;
  description?: string | null;
  ownerId: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers:
      init.body !== undefined
        ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
        : init.headers,
    ...init,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body
  }

  if (!res.ok) {
    const err = body as { error?: string; message?: string; code?: string } | null;
    throw new ApiError(
      res.status,
      err?.message ?? err?.error ?? `Request failed with status ${res.status}`,
      err?.code,
    );
  }

  return body as T;
}

export const api = {
  // ---- auth ----
  me: () => request<{ user: UserDTO }>('/auth/me'),
  nonce: () => request<{ nonce: string; nonceId?: string }>('/auth/nonce'),
  verify: (payload: { message: string; signature: string }) =>
    request<{ user: UserDTO }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  // ---- projects ----
  listProjects: () => request<{ projects: ProjectDTO[] }>('/projects'),
  createProject: (input: CreateProjectInput) =>
    request<ProjectDTO>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- agents ----
  listAgents: (projectId: string) =>
    request<AgentDTO[]>(`/projects/${projectId}/agents`),
  createAgent: (projectId: string, input: CreateAgentDTO) =>
    request<AgentDTO>(`/projects/${projectId}/agents`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- tasks ----
  listTasks: (projectId: string) =>
    request<TaskListResponseDTO>(`/projects/${projectId}/tasks?limit=100`),
  createTask: (projectId: string, input: CreateTaskInput) =>
    request<TaskDTO>(`/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getTask: (projectId: string, taskId: string) =>
    request<TaskDTO>(`/projects/${projectId}/tasks/${taskId}`),
  updateTask: (projectId: string, taskId: string, input: UpdateTaskInput) =>
    request<TaskDTO>(`/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  assignTask: (projectId: string, taskId: string, preferredAgentId?: string) =>
    request<{ assigned: boolean; agentId?: string }>(
      `/projects/${projectId}/tasks/${taskId}/assign`,
      {
        method: 'POST',
        body: JSON.stringify(preferredAgentId ? { preferredAgentId } : {}),
      },
    ),

  // ---- artifacts ----
  listArtifacts: (projectId: string, taskId: string) =>
    request<{ items: ArtifactItem[]; total: number }>(
      `/projects/${projectId}/tasks/${taskId}/artifacts`,
    ),
  reviewArtifact: (
    projectId: string,
    artifactId: string,
    decision: { approved: boolean; note?: string },
  ) =>
    request<{ artifact: ArtifactItem; task: TaskDTO }>(
      `/projects/${projectId}/artifacts/${artifactId}/review`,
      {
        method: 'POST',
        body: JSON.stringify(decision),
      },
    ),

  // ---- activity ----
  listActivity: (projectId: string) =>
    request<{ events: ActivityEventItem[] }>(`/projects/${projectId}/activity`),
};

export interface ArtifactItem {
  id: string;
  projectId: string;
  taskId: string;
  agentId: string;
  ownerUserId: string;
  type: string;
  name: string;
  version: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requiresReview: boolean;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  payload: unknown;
  contentHash?: string;
  createdAt: string;
}

export interface ActivityEventItem {
  id: string;
  projectId: string;
  type: string;
  actorType: string;
  actorId: string;
  actorName?: string | null;
  taskId?: string | null;
  artifactId?: string | null;
  message?: string | null;
  createdAt: string;
}