import { AgentConnectionAdapter, Agent, ProtocolEvent } from '../types';
import { apiClient } from '../../services/api-client';

export class LiveAgentConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveAgentConnectionError';
  }
}

export const liveAgentConnectionAdapter: AgentConnectionAdapter = {
  async getAvailableAgents(): Promise<Agent[]> {
    return await apiClient.get<Agent[]>('/agents');
  },

  async connectAgent(agentId: string, options?: { provider?: string; repoScope?: string }): Promise<Agent> {
    return await apiClient.post<Agent>(`/agents/${encodeURIComponent(agentId)}/connect`, options);
  },

  async disconnectAgent(agentId: string): Promise<void> {
    await apiClient.post(`/agents/${encodeURIComponent(agentId)}/disconnect`);
  },

  async announceCapabilities(_agentId: string, _capabilities: string[]): Promise<ProtocolEvent> {
    throw new LiveAgentConnectionError('Live capability announcement event broadcasting is not supported directly via this adapter in Live Mode.');
  },
};
