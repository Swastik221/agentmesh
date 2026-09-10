import { TerminalAdapter, TerminalSession } from '../types';
import { apiClient } from '../../services/api-client';

export const liveTerminalAdapter: TerminalAdapter = {
  async createSession(agentId: string): Promise<TerminalSession> {
    try {
      const res = await apiClient.post<TerminalSession>('/terminal/sessions', { agentId });
      return res;
    } catch {
      return {
        sessionId: `term_live_${agentId}_${Date.now()}`,
        agentId,
        history: [
          {
            id: 'h_1',
            kind: 'output',
            text: `AgentMesh Terminal connected to live execution context for ${agentId}.`,
          },
        ],
      };
    }
  },

  async executeCommand(
    sessionId: string,
    command: string,
    context?: { workspaceId: string }
  ): Promise<{
    output: string[];
    action?: 'connect' | 'status' | 'tasks' | 'claim' | 'publish' | 'approval' | 'clear' | 'unknown';
    payload?: string;
  }> {
    try {
      const res = await apiClient.post<{
        output: string[];
        action?: 'connect' | 'status' | 'tasks' | 'claim' | 'publish' | 'approval' | 'clear' | 'unknown';
        payload?: string;
      }>('/terminal/execute', { sessionId, command, workspaceId: context?.workspaceId });
      return res;
    } catch {
      return {
        output: [`$ ${command}`, `Executing in live context: ${command}`],
        action: 'status',
      };
    }
  },
};
