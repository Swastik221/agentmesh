import { TerminalAdapter, TerminalSession } from '../types';
import { apiClient } from '../../services/api-client';

export class LiveTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveTerminalError';
  }
}

export const liveTerminalAdapter: TerminalAdapter = {
  async createSession(agentId: string): Promise<TerminalSession> {
    try {
      return await apiClient.post<TerminalSession>('/terminal/sessions', { agentId });
    } catch {
      throw new LiveTerminalError(`Live interactive terminal session creation for agent ${agentId} is not supported or backend endpoint unavailable.`);
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
      return await apiClient.post<{
        output: string[];
        action?: 'connect' | 'status' | 'tasks' | 'claim' | 'publish' | 'approval' | 'clear' | 'unknown';
        payload?: string;
      }>('/terminal/execute', { sessionId, command, workspaceId: context?.workspaceId });
    } catch {
      throw new LiveTerminalError(`Live command execution ('${command}') is not supported or backend execution endpoint unavailable.`);
    }
  },
};
