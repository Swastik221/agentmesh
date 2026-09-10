import { TaskProtocolAdapter, Task, ApprovalRequest } from '../types';
import { apiClient } from '../../services/api-client';

export const liveTaskProtocolAdapter: TaskProtocolAdapter = {
  async getTasks(workspaceId: string): Promise<Task[]> {
    try {
      const res = await apiClient.get<Task[]>(`/projects/${encodeURIComponent(workspaceId)}/tasks`);
      return res;
    } catch {
      return [];
    }
  },

  async submitPrd(workspaceId: string, prdText: string): Promise<Task[]> {
    try {
      const res = await apiClient.post<Task[]>(`/projects/${encodeURIComponent(workspaceId)}/tasks/prd`, { prdText });
      return res;
    } catch {
      return [];
    }
  },

  async claimTask(workspaceId: string, taskId: string, agentId: string): Promise<Task> {
    try {
      const res = await apiClient.post<Task>(`/projects/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/claim`, { agentId });
      return res;
    } catch {
      return {
        id: taskId,
        title: 'Claimed Task',
        capability: 'API',
        status: 'claimed',
        suggestedAgent: agentId,
        claimedBy: agentId,
      };
    }
  },

  async autoAssignTask(workspaceId: string, taskId: string, agentId: string): Promise<Task> {
    try {
      const res = await apiClient.post<Task>(`/projects/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/auto-assign`, { agentId });
      return res;
    } catch {
      return {
        id: taskId,
        title: 'Auto-Assigned Task',
        capability: 'API',
        status: 'auto-assigned',
        suggestedAgent: agentId,
        claimedBy: agentId,
      };
    }
  },

  async requestApproval(workspaceId: string, request: ApprovalRequest): Promise<ApprovalRequest> {
    try {
      const res = await apiClient.post<ApprovalRequest>(`/projects/${encodeURIComponent(workspaceId)}/approvals`, request);
      return res;
    } catch {
      return {
        ...request,
        status: 'pending',
      };
    }
  },

  async decideApproval(_workspaceId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<ApprovalRequest> {
    try {
      const res = await apiClient.post<ApprovalRequest>(`/approvals/${encodeURIComponent(approvalId)}/decide`, { decision });
      return res;
    } catch {
      return {
        id: approvalId,
        action: 'Web3 Settlement',
        detail: 'Spend threshold approval',
        requestedBy: 'agent-orion',
        ownerEns: 'dev1.eth',
        status: decision,
      };
    }
  },
};
