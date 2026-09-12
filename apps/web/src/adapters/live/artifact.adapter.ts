import { apiClient, ApiError } from '../../services/api-client';

export type LiveArtifactStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface LiveArtifactAgent {
  id: string;
  name: string;
  provider: string;
}

export interface LiveArtifactOwnerUser {
  id: string;
  displayName: string;
  walletAddress?: string | null;
}

export interface LiveArtifactTask {
  id: string;
  title: string;
  status: string;
}

export interface LiveArtifact {
  id: string;
  projectId: string;
  taskId: string;
  executionId?: string | null;
  agentId: string;
  ownerUserId: string;
  type: string;
  name: string;
  version: number;
  payload: unknown;
  requiresReview: boolean;
  status: LiveArtifactStatus;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  createdAt: string;
  updatedAt: string;
  contentHash?: string;
  agent?: LiveArtifactAgent;
}

export interface LiveArtifactDetail extends LiveArtifact {
  contentHash: string;
  agent?: LiveArtifactAgent;
  ownerUser?: LiveArtifactOwnerUser;
  task?: LiveArtifactTask;
}

export interface ListArtifactsQuery {
  page?: number;
  limit?: number;
  type?: string;
}

export interface PaginatedArtifactsResponse {
  items: LiveArtifact[];
  page: number;
  limit: number;
  total: number;
}

export interface ReviewArtifactInput {
  approved: boolean;
  note?: string;
}

export interface ReviewArtifactResult {
  artifact: LiveArtifact;
  task: LiveArtifactTask;
}

export function artifactErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Session expired. Please sign in to view artifacts.';
    if (error.status === 403) return 'Access denied. You are not a member of this project.';
    if (error.status === 404) return 'Artifact or task not found.';
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Failed to load artifacts. Please try again.';
}

export class LiveArtifactAdapter {
  /**
   * List artifacts for a specific task in a project.
   */
  async listArtifacts(
    projectId: string,
    taskId: string,
    query?: ListArtifactsQuery
  ): Promise<PaginatedArtifactsResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (query?.page) params.page = query.page;
    if (query?.limit) params.limit = query.limit;
    if (query?.type) params.type = query.type;

    return apiClient.get<PaginatedArtifactsResponse>(
      `/api/projects/${projectId}/tasks/${taskId}/artifacts`,
      { params }
    );
  }

  /**
   * Safe helper fetching all artifact pages for a task.
   */
  async listAllArtifacts(
    projectId: string,
    taskId: string,
    options?: { type?: string }
  ): Promise<LiveArtifact[]> {
    const limit = 50;
    let page = 1;
    let all: LiveArtifact[] = [];
    let total = 0;

    do {
      const res = await this.listArtifacts(projectId, taskId, {
        page,
        limit,
        type: options?.type,
      });
      all = all.concat(res.items);
      total = res.total;
      page++;
    } while (all.length < total && page <= 50);

    return all;
  }

  /**
   * Get full artifact details including server-calculated contentHash.
   */
  async getArtifact(projectId: string, artifactId: string): Promise<LiveArtifactDetail> {
    return apiClient.get<LiveArtifactDetail>(
      `/api/projects/${projectId}/artifacts/${artifactId}`
    );
  }

  /**
   * Submit human review decision for an artifact requiring review.
   */
  async reviewArtifact(
    projectId: string,
    artifactId: string,
    decision: ReviewArtifactInput
  ): Promise<ReviewArtifactResult> {
    return apiClient.post<ReviewArtifactResult>(
      `/api/projects/${projectId}/artifacts/${artifactId}/review`,
      decision
    );
  }
}

export const artifactAdapter = new LiveArtifactAdapter();
