import { apiClient, ApiError } from '../../services/api-client';
import type { LiveAgent } from './agent.adapter';

/**
 * Live Approval adapter.
 *
 * Talks to the real backend approval routes, all under `/approvals`, mounted
 * at root in `app.ts`, NOT nested under `/projects/:id` like tasks and
 * executions (confirmed directly against `approval.router.ts`).
 *
 * Real creation paths, confirmed by reading every call site of
 * `approvalService.createApprovalRequest`: only `task.execute`
 * (`execution.service.ts`) is reachable from the live UI today, via
 * `ExecutionPanel`'s "Start execution". `artifact.write`
 * (`artifact.service.ts`) is a second real path with the identical shape,
 * but nothing in the live UI can trigger an artifact creation yet, so it has
 * no consumer here. `capability.execute`
 * (`agent-capability.controller.ts`) returns a 202 but never creates a real
 * `ApprovalRequest` row at all (a separate, incomplete payment-gate stub),
 * so it isn't a case this adapter handles.
 *
 * The list envelope is `{ requests, total, page, limit }`, not
 * `{ items, ... }` like tasks and executions, confirmed directly against
 * `approvalService.listApprovalRequests`. Approve and reject resolve the
 * real row directly, no envelope.
 *
 * No real-time push exists for approval decisions: `approval.service.ts`
 * broadcasts through raw `connectionManager.broadcastToProject` messages,
 * not the sequenced delta system, and `'approval'` is not a valid entity in
 * the protocol's delta schema. By decision, this is left as a polling
 * concern on the frontend (`useApprovals`), matching the precedent already
 * accepted for execution status in PRD-45, rather than adding new protocol
 * surface for a case that hasn't shown a real need for it.
 *
 * `EXPIRED` is a valid status in the Prisma schema, but no code path
 * anywhere ever sets it (confirmed by grep); it's typed for completeness,
 * nothing here builds UI for it.
 */

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface ApprovalUser {
  id: string;
  walletAddress: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalPolicy {
  id: string;
  name: string;
  action: string;
  decision: string;
}

export interface ApprovalRequestRecord {
  id: string;
  projectId: string;
  policyId: string | null;
  requestedByUserId: string;
  agentId: string | null;
  action: string;
  idempotencyKey: string | null;
  status: ApprovalStatus;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  policy?: ApprovalPolicy | null;
  requestedByUser?: ApprovalUser;
  resolvedByUser?: ApprovalUser | null;
  agent?: LiveAgent | null;
}

export interface ApprovalListResult {
  requests: ApprovalRequestRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface ListApprovalsQuery {
  projectId?: string;
  status?: ApprovalStatus;
  page?: number;
  limit?: number;
}

export interface ApprovalAdapter {
  listApprovals(query?: ListApprovalsQuery): Promise<ApprovalListResult>;
  getApproval(approvalId: string): Promise<ApprovalRequestRecord>;
  approveRequest(approvalId: string, reason?: string): Promise<ApprovalRequestRecord>;
  rejectRequest(approvalId: string, reason?: string): Promise<ApprovalRequestRecord>;
}

export const liveApprovalAdapter: ApprovalAdapter = {
  async listApprovals(query: ListApprovalsQuery = {}): Promise<ApprovalListResult> {
    const params: Record<string, string | number> = {};
    if (query.projectId) params.projectId = query.projectId;
    if (query.status) params.status = query.status;
    if (query.page !== undefined) params.page = query.page;
    if (query.limit !== undefined) params.limit = query.limit;
    return apiClient.get<ApprovalListResult>('/approvals', { params });
  },

  async getApproval(approvalId: string): Promise<ApprovalRequestRecord> {
    return apiClient.get<ApprovalRequestRecord>(`/approvals/${encodeURIComponent(approvalId)}`);
  },

  async approveRequest(approvalId: string, reason?: string): Promise<ApprovalRequestRecord> {
    const body: { reason?: string } = {};
    if (reason !== undefined && reason !== '') body.reason = reason;
    return apiClient.post<ApprovalRequestRecord>(`/approvals/${encodeURIComponent(approvalId)}/approve`, body);
  },

  async rejectRequest(approvalId: string, reason?: string): Promise<ApprovalRequestRecord> {
    const body: { reason?: string } = {};
    if (reason !== undefined && reason !== '') body.reason = reason;
    return apiClient.post<ApprovalRequestRecord>(`/approvals/${encodeURIComponent(approvalId)}/reject`, body);
  },
};

/** Best human-readable message from a thrown error. `apiClient` already picks it. */
export function approvalErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Something went wrong';
}
