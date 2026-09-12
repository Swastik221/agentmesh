import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  artifactAdapter,
  artifactErrorMessage,
  type LiveArtifact,
  type LiveArtifactDetail,
} from '../artifact.adapter';
import { apiClient, ApiError } from '../../../services/api-client';

const sampleArtifact = (over: Partial<LiveArtifact> = {}): LiveArtifact => ({
  id: 'art_1',
  projectId: 'proj_1',
  taskId: 'task_1',
  executionId: 'exec_1',
  agentId: 'agent_1',
  ownerUserId: 'user_1',
  type: 'API_SPEC',
  name: 'payment-api.json',
  version: 1,
  payload: { endpoints: ['/pay', '/refund'], version: '1.0' },
  requiresReview: false,
  status: 'APPROVED',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const sampleDetail = (over: Partial<LiveArtifactDetail> = {}): LiveArtifactDetail => ({
  ...sampleArtifact(),
  contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  agent: { id: 'agent_1', name: 'Codex', provider: 'OpenAI' },
  ownerUser: { id: 'user_1', displayName: 'Alice', walletAddress: '0x1234' },
  task: { id: 'task_1', title: 'Implement payment API', status: 'COMPLETED' },
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LiveArtifactAdapter', () => {
  it('listArtifacts GETs /api/projects/:id/tasks/:taskId/artifacts and returns paginated response', async () => {
    const res = { items: [sampleArtifact()], page: 1, limit: 20, total: 1 };
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(res);

    const out = await artifactAdapter.listArtifacts('proj_1', 'task_1');

    expect(spy).toHaveBeenCalledWith('/api/projects/proj_1/tasks/task_1/artifacts', { params: {} });
    expect(out).toEqual(res);
  });

  it('listArtifacts forwards pagination and type parameters', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ items: [], page: 2, limit: 10, total: 0 });

    await artifactAdapter.listArtifacts('proj_1', 'task_1', { page: 2, limit: 10, type: 'API_SPEC' });

    expect(spy).toHaveBeenCalledWith('/api/projects/proj_1/tasks/task_1/artifacts', {
      params: { page: 2, limit: 10, type: 'API_SPEC' },
    });
  });

  it('listAllArtifacts fetches across multiple pages when total exceeds single page limit', async () => {
    const page1Items = Array.from({ length: 50 }, (_, i) => sampleArtifact({ id: `art_${i}` }));
    const page2Items = [sampleArtifact({ id: 'art_50' })];

    const spy = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ items: page1Items, page: 1, limit: 50, total: 51 })
      .mockResolvedValueOnce({ items: page2Items, page: 2, limit: 50, total: 51 });

    const all = await artifactAdapter.listAllArtifacts('proj_1', 'task_1');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(all).toHaveLength(51);
  });

  it('getArtifact GETs /api/projects/:id/artifacts/:artifactId and returns detail with server contentHash', async () => {
    const detail = sampleDetail();
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(detail);

    const out = await artifactAdapter.getArtifact('proj_1', 'art_1');

    expect(spy).toHaveBeenCalledWith('/api/projects/proj_1/artifacts/art_1');
    expect(out.contentHash).toEqual('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(out.agent?.name).toEqual('Codex');
  });

  it('reviewArtifact POSTs decision to /api/projects/:id/artifacts/:artifactId/review', async () => {
    const expectedRes = {
      artifact: sampleArtifact({ status: 'APPROVED' }),
      task: { id: 'task_1', status: 'COMPLETED' },
    };
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(expectedRes);

    const out = await artifactAdapter.reviewArtifact('proj_1', 'art_1', {
      approved: true,
      note: 'Looks good!',
    });

    expect(spy).toHaveBeenCalledWith('/api/projects/proj_1/artifacts/art_1/review', {
      approved: true,
      note: 'Looks good!',
    });
    expect(out).toEqual(expectedRes);
  });

  it('artifactErrorMessage formats HTTP 401, 403, 404 and generic API errors', () => {
    expect(artifactErrorMessage(new ApiError(401, 'Unauthorized', 'Unauthorized'))).toBe(
      'Session expired. Please sign in to view artifacts.'
    );
    expect(artifactErrorMessage(new ApiError(403, 'Forbidden', 'Forbidden'))).toBe(
      'Access denied. You are not a member of this project.'
    );
    expect(artifactErrorMessage(new ApiError(404, 'Not Found', 'Not Found'))).toBe(
      'Artifact or task not found.'
    );
    expect(artifactErrorMessage(new ApiError(500, 'Internal', 'Database query failed'))).toBe(
      'Database query failed'
    );
    expect(artifactErrorMessage(new Error('Network offline'))).toBe('Network offline');
  });

  it('throws ApiError without falling back to demo data on API failure', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(500, 'Internal', 'Server error'));

    await expect(artifactAdapter.getArtifact('proj_1', 'art_99')).rejects.toThrow('Server error');
  });
});
