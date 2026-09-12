import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  artifactAdapter,
  artifactErrorMessage,
  type LiveArtifact,
  type LiveArtifactDetail,
  type ReviewArtifactInput,
  type ReviewArtifactResult,
} from '../adapters/live/artifact.adapter';
import { useWorkspaceRealtime, type RealtimeDeltaEvent } from './useWorkspaceRealtime';

export interface UseArtifactsResult {
  artifacts: LiveArtifact[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  getArtifactDetail: (artifactId: string) => Promise<LiveArtifactDetail>;
  reviewArtifact: (artifactId: string, decision: ReviewArtifactInput) => Promise<ReviewArtifactResult>;
}

export function useArtifacts(projectId: string | null, taskId?: string): UseArtifactsResult {
  const [artifacts, setArtifacts] = useState<LiveArtifact[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId && taskId));
  const [error, setError] = useState<string | null>(null);

  const fetchArtifacts = useCallback(async () => {
    if (!projectId || !taskId) {
      setArtifacts([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const items = await artifactAdapter.listAllArtifacts(projectId, taskId);
      setArtifacts(items);
    } catch (err) {
      setError(artifactErrorMessage(err));
      setArtifacts([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId]);

  useEffect(() => {
    void fetchArtifacts();
  }, [fetchArtifacts]);

  // Refetch on realtime artifact delta/resync events
  const fetchRef = useRef(fetchArtifacts);
  fetchRef.current = fetchArtifacts;

  useWorkspaceRealtime(
    projectId,
    useMemo(
      () => ({
        onDelta: (event: RealtimeDeltaEvent) => {
          if (event.entity === 'artifact') {
            void fetchRef.current();
          }
        },
        onResync: () => void fetchRef.current(),
      }),
      []
    )
  );

  const getArtifactDetail = useCallback(
    async (artifactId: string): Promise<LiveArtifactDetail> => {
      if (!projectId) throw new Error('Project ID is required');
      return artifactAdapter.getArtifact(projectId, artifactId);
    },
    [projectId]
  );

  const reviewArtifact = useCallback(
    async (artifactId: string, decision: ReviewArtifactInput): Promise<ReviewArtifactResult> => {
      if (!projectId) throw new Error('Project ID is required');
      const res = await artifactAdapter.reviewArtifact(projectId, artifactId, decision);
      void fetchArtifacts();
      return res;
    },
    [projectId, fetchArtifacts]
  );

  return {
    artifacts,
    loading,
    error,
    refetch: fetchArtifacts,
    getArtifactDetail,
    reviewArtifact,
  };
}
