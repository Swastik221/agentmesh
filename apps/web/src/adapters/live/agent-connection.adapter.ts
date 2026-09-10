import { AgentConnectionAdapter, Agent, ProtocolEvent } from '../types';
import { apiClient } from '../../services/api-client';

export class LiveAgentConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveAgentConnectionError';
  }
}

export const liveAgentConnectionAdapter: AgentConnectionAdapter = {
  async getAvailableAgents(projectId?: string): Promise<Agent[]> {
    if (!projectId) {
      throw new LiveAgentConnectionError('Project ID is required to fetch available agents in Live Mode.');
    }
    return await apiClient.get<Agent[]>(`/projects/${encodeURIComponent(projectId)}/agents`);
  },

  async connectAgent(_agentId: string, _options?: { provider?: string; repoScope?: string }): Promise<Agent> {
    throw new LiveAgentConnectionError('Agent connect capability is unsupported in Live Mode in INT-1.');
  },

  async disconnectAgent(_agentId: string): Promise<void> {
    throw new LiveAgentConnectionError('Agent disconnect capability is unsupported in Live Mode in INT-1.');
  },

  async announceCapabilities(_agentId: string, _capabilities: string[]): Promise<ProtocolEvent> {
    throw new LiveAgentConnectionError('Live capability announcement event broadcasting is unsupported in Live Mode in INT-1.');
  },
};
