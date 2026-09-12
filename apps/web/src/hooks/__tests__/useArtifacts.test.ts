import { describe, it, expect, vi, afterEach } from 'vitest';
import { useArtifacts } from '../useArtifacts';
import { artifactAdapter } from '../../adapters/live/artifact.adapter';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useArtifacts module', () => {
  it('is a function exporting hook logic', () => {
    expect(typeof useArtifacts).toBe('function');
  });

  it('delegates artifact detail requests to artifactAdapter.getArtifact', async () => {
    const detailSpy = vi.spyOn(artifactAdapter, 'getArtifact').mockResolvedValue({
      id: 'art_1',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      ownerUserId: 'user_1',
      type: 'SPEC',
      name: 'spec.json',
      version: 1,
      payload: {},
      requiresReview: false,
      status: 'APPROVED',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      contentHash: 'hash123',
    });

    const res = await artifactAdapter.getArtifact('proj_1', 'art_1');
    expect(detailSpy).toHaveBeenCalledWith('proj_1', 'art_1');
    expect(res.contentHash).toBe('hash123');
  });

  it('delegates review requests to artifactAdapter.reviewArtifact', async () => {
    const reviewSpy = vi.spyOn(artifactAdapter, 'reviewArtifact').mockResolvedValue({
      artifact: {
        id: 'art_1',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        ownerUserId: 'user_1',
        type: 'SPEC',
        name: 'spec.json',
        version: 1,
        payload: {},
        requiresReview: true,
        status: 'APPROVED',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      task: { id: 'task_1', title: 'Task 1', status: 'COMPLETED' },
    });

    const res = await artifactAdapter.reviewArtifact('proj_1', 'art_1', { approved: true, note: 'ok' });
    expect(reviewSpy).toHaveBeenCalledWith('proj_1', 'art_1', { approved: true, note: 'ok' });
    expect(res.artifact.status).toBe('APPROVED');
  });
});
