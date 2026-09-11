import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveApprovalAdapter, approvalErrorMessage } from '../approval.adapter';
import type { ApprovalRequestRecord } from '../approval.adapter';
import { apiClient, ApiError } from '../../../services/api-client';

const sampleApproval = (over: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord => ({
  id: 'appr_1',
  projectId: 'proj_1',
  policyId: 'policy_1',
  requestedByUserId: 'user_1',
  agentId: 'agent_1',
  action: 'task.execute',
  idempotencyKey: null,
  status: 'PENDING',
  reason: 'Action task.execute requires human approval per policy default',
  metadata: { taskId: 'task_1', agentId: 'agent_1' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  resolvedAt: null,
  resolvedByUserId: null,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('liveApprovalAdapter', () => {
  // ---- list: the real envelope is { requests, ... }, not { items, ... } ---
  it('listApprovals GETs /approvals and returns the real requests envelope', async () => {
    const result = { requests: [sampleApproval()], page: 1, limit: 20, total: 1 };
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(result);

    const out = await liveApprovalAdapter.listApprovals();

    expect(spy).toHaveBeenCalledWith('/approvals', { params: {} });
    // Guards the exact silent-parsing bug this envelope invites: if the
    // adapter ever assumed `{ items }` like tasks/executions, `out.requests`
    // would be real data while a caller reading `out.items` got `undefined`
    // with no error anywhere.
    expect(out.requests).toEqual([sampleApproval()]);
    expect(out).toEqual(result);
    expect((out as unknown as { items?: unknown }).items).toBeUndefined();
  });

  it('listApprovals forwards projectId/status/page/limit as query params', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ requests: [], page: 2, limit: 10, total: 0 });
    await liveApprovalAdapter.listApprovals({ projectId: 'proj_1', status: 'PENDING', page: 2, limit: 10 });
    expect(spy).toHaveBeenCalledWith('/approvals', {
      params: { projectId: 'proj_1', status: 'PENDING', page: 2, limit: 10 },
    });
  });

  it('listApprovals omits unset query params entirely', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ requests: [], page: 1, limit: 20, total: 0 });
    await liveApprovalAdapter.listApprovals({ projectId: 'proj_1' });
    expect(spy).toHaveBeenCalledWith('/approvals', { params: { projectId: 'proj_1' } });
  });

  // ---- get -----------------------------------------------------------------
  it('getApproval GETs /approvals/:id encoded', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(sampleApproval());
    await liveApprovalAdapter.getApproval('appr 1');
    expect(spy).toHaveBeenCalledWith('/approvals/appr%201');
  });

  // ---- approve / reject: real, unrouted (no /projects/:id prefix) ----------
  it('approveRequest POSTs /approvals/:id/approve, no reason when omitted', async () => {
    const approved = sampleApproval({ status: 'APPROVED', resolvedByUserId: 'user_2' });
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(approved);

    const out = await liveApprovalAdapter.approveRequest('appr_1');

    expect(spy).toHaveBeenCalledWith('/approvals/appr_1/approve', {});
    expect(out).toEqual(approved);
  });

  it('approveRequest includes reason only when provided and non-empty', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(sampleApproval({ status: 'APPROVED' }));
    await liveApprovalAdapter.approveRequest('appr_1', 'looks safe');
    expect(spy).toHaveBeenCalledWith('/approvals/appr_1/approve', { reason: 'looks safe' });

    spy.mockClear();
    await liveApprovalAdapter.approveRequest('appr_1', '');
    expect(spy).toHaveBeenCalledWith('/approvals/appr_1/approve', {});
  });

  it('rejectRequest POSTs /approvals/:id/reject', async () => {
    const rejected = sampleApproval({ status: 'REJECTED', resolvedByUserId: 'user_2' });
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(rejected);

    const out = await liveApprovalAdapter.rejectRequest('appr_1', 'not now');

    expect(spy).toHaveBeenCalledWith('/approvals/appr_1/reject', { reason: 'not now' });
    expect(out).toEqual(rejected);
  });

  it('approveRequest propagates a 409 when the request is no longer PENDING', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(409, 'Conflict', "Cannot approve request in status 'APPROVED'", { error: 'CONFLICT' }),
    );
    await expect(liveApprovalAdapter.approveRequest('appr_1')).rejects.toMatchObject({ status: 409 });
  });

  it('rejectRequest propagates a 403 when the actor is not a project member', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(403, 'Forbidden', 'User is not a member of this project'),
    );
    await expect(liveApprovalAdapter.rejectRequest('appr_1')).rejects.toMatchObject({ status: 403 });
  });

  // ---- auth / failure propagation on reads ---------------------------------
  it('listApprovals propagates a 401 ApiError', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(401, 'Unauthorized', 'Authentication required'));
    await expect(liveApprovalAdapter.listApprovals()).rejects.toMatchObject({ status: 401 });
  });

  it('listApprovals propagates a 500 ApiError and never an empty list', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(500, 'Internal Server Error', 'boom'));
    await expect(liveApprovalAdapter.listApprovals()).rejects.toBeInstanceOf(ApiError);
  });

  it('approveRequest surfaces the real server validation message via approvalErrorMessage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: 'CONFLICT', message: "Cannot approve request in status 'REJECTED'" }),
          ),
      }),
    );
    try {
      await liveApprovalAdapter.approveRequest('appr_1');
      throw new Error('should have thrown');
    } catch (err) {
      expect(approvalErrorMessage(err)).toBe("Cannot approve request in status 'REJECTED'");
    }
  });
});

describe('approvalErrorMessage', () => {
  it('returns ApiError.message verbatim', () => {
    const err = new ApiError(403, 'Forbidden', 'User is not a member of this project');
    expect(approvalErrorMessage(err)).toBe('User is not a member of this project');
  });

  it('handles plain errors and unknowns', () => {
    expect(approvalErrorMessage(new Error('nope'))).toBe('nope');
    expect(approvalErrorMessage('weird')).toBe('Something went wrong');
  });
});
