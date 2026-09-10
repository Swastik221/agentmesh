import { TaskProtocolAdapter, Task, ApprovalRequest } from '../types';
import { apiClient } from '../../services/api-client';

export class LiveTaskProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveTaskProtocolError';
  }
}

export const liveTaskProtocolAdapter: TaskProtocolAdapter = {
  async getTasks(workspaceId: string): Promise<Task[]> {
    return await apiClient.get<Task[]>(`/projects/${encodeURIComponent(workspaceId)}/tasks`);
  },

  async submitPrd(_workspaceId: string, _prdText: string): Promise<Task[]> {
    throw new LiveTaskProtocolError('PRD submission and task breakdown is unsupported in Live Mode in INT-1.');
  },

  async claimTask(_workspaceId: string, _taskId: string, _agentId: string): Promise<Task> {
    throw new LiveTaskProtocolError('Task claiming via task adapter is unsupported in Live Mode in INT-1.');
  },

  async autoAssignTask(_workspaceId: string, _taskId: string, _agentId: string): Promise<Task> {
    throw new LiveTaskProtocolError('Auto-assigning tasks via task adapter is unsupported in Live Mode in INT-1.');
  },

  async requestApproval(workspaceId: string, request: ApprovalRequest): Promise<ApprovalRequest> {
    return await apiClient.post<ApprovalRequest>('/approvals', {
      projectId: workspaceId,
      action: request.action,
      reason: request.detail,
      metadata: request.spendThreshold ? { spendThreshold: request.spendThreshold } : undefined,
    });
  },

  async decideApproval(_workspaceId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<ApprovalRequest> {
    const endpoint = decision === 'approved'
      ? `/approvals/${encodeURIComponent(approvalId)}/approve`
      : `/approvals/${encodeURIComponent(approvalId)}/reject`;

    return await apiClient.post<ApprovalRequest>(endpoint, {});
  },
};
