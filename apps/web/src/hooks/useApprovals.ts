import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  liveApprovalAdapter,
  approvalErrorMessage,
  type ApprovalRequestRecord,
} from '../adapters/live/approval.adapter';

const POLL_INTERVAL_MS = 2000;

export interface UseApprovalsResult {
  approvals: ApprovalRequestRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  approve: (approvalId: string, reason?: string) => Promise<ApprovalRequestRecord>;
  reject: (approvalId: string, reason?: string) => Promise<ApprovalRequestRecord>;
}

/**
 * Loads and manages the real PENDING approval requests for one project.
 *
 * No websocket or delta signal exists for approval decisions (confirmed
 * directly against the server: approval.service.ts broadcasts through raw
 * connectionManager.broadcastToProject messages, not the sequenced delta
 * system, and 'approval' is not a valid entity in the protocol's delta
 * schema). By decision, this polls instead, matching the exact precedent
 * already accepted for execution status in PRD-45: it polls while it holds
 * at least one PENDING request, and stops once none remain, recomputed from
 * `approvals` on every render so it re-arms on its own the moment a fresh
 * PENDING request appears later, even after polling had already stopped.
 *
 * Only PENDING requests are fetched: once approved or rejected a request
 * naturally drops out of this list on the next load, since it is no longer
 * PENDING. `approve`/`reject` still resolve with the real, updated row so a
 * caller can show its terminal outcome without needing to keep fetching
 * REJECTED/APPROVED rows just to report on the one it just acted on.
 *
 * Pass `null` for `projectId` when no project is selected: the hook then
 * holds an empty, non-loading, error-free state and makes no request.
 */
export function useApprovals(projectId: string | null): UseApprovalsResult {
  const [approvals, setApprovals] = useState<ApprovalRequestRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setApprovals([]);
      setError(null);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const result = await liveApprovalAdapter.listApprovals({
        projectId,
        status: 'PENDING',
        limit: 100,
      });
      setApprovals(result.requests);
    } catch (err) {
      setError(approvalErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(Boolean(projectId));
    void load();
  }, [load, projectId]);

  const hasPending = useMemo(() => approvals.length > 0, [approvals]);

  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasPending, load]);

  const approve = useCallback(
    async (approvalId: string, reason?: string): Promise<ApprovalRequestRecord> => {
      const result = await liveApprovalAdapter.approveRequest(approvalId, reason);
      await load();
      return result;
    },
    [load],
  );

  const reject = useCallback(
    async (approvalId: string, reason?: string): Promise<ApprovalRequestRecord> => {
      const result = await liveApprovalAdapter.rejectRequest(approvalId, reason);
      await load();
      return result;
    },
    [load],
  );

  return { approvals, loading, error, refetch: load, approve, reject };
}
