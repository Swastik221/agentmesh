import { TaskProtocolAdapter, Task, ApprovalRequest } from '../types';
import { apiClient } from '../../services/api-client';

export const liveTaskProtocolAdapter: TaskProtocolAdapter = {
  async getTasks(workspaceId: string): Promise<Task[]> {
    return await apiClient.get<Task[]>(`/projects/${encodeURIComponent(workspaceId)}/tasks`);
  },

  async submitPrd(workspaceId: string, prdText: string): Promise<Task[]> {
    return await apiClient.post<Task[]>(`/projects/${encodeURIComponent(workspaceId)}/tasks/prd`, { prdText });
  },

  async claimTask(workspaceId: string, taskId: string, agentId: string): Promise<Task> {
    return await apiClient.post<Task>(`/projects/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/claim`, { agentId });
  },

  async autoAssignTask(workspaceId: string, taskId: string, agentId: string): Promise<Task> {
    return await apiClient.post<Task>(`/projects/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/auto-assign`, { agentId });
  },

  async requestApproval(workspaceId: string, request: ApprovalRequest): Promise<ApprovalRequest> {
    return await apiClient.post<ApprovalRequest>(`/projects/${encodeURIComponent(workspaceId)}/approvals`, request);
  },

  async decideApproval(_workspaceId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<ApprovalRequest> {
    return await apiClient.post<ApprovalRequest>(`/approvals/${encodeURIComponent(approvalId)}/decide`, { decision });
  },
};
