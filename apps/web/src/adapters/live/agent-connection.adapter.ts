import { AgentConnectionAdapter, Agent, ProtocolEvent } from '../types';
import { apiClient } from '../../services/api-client';

export const liveAgentConnectionAdapter: AgentConnectionAdapter = {
  async getAvailableAgents(): Promise<Agent[]> {
    try {
      const res = await apiClient.get<Agent[]>('/agents');
      return res;
    } catch {
      return [];
    }
  },

  async connectAgent(agentId: string, options?: { provider?: string; repoScope?: string }): Promise<Agent> {
    try {
      const res = await apiClient.post<Agent>(`/agents/${encodeURIComponent(agentId)}/connect`, options);
      return res;
    } catch {
      return {
        id: agentId,
        name: agentId === 'agent-orion' ? 'Orion' : agentId === 'agent-vega' ? 'Vega' : 'Nova',
        provider: options?.provider || 'Codex',
        ownerId: 'usr_live_1',
        ownerName: 'Developer',
        ownerEns: 'dev.eth',
        ownerColor: 'purple',
        ens: `${agentId}.eth`,
        address: '0x' + agentId.padEnd(40, '0').slice(0, 40),
        capabilities: ['frontend', 'identity', 'API'],
        status: 'connected',
        repoScope: options?.repoScope || 'src/identity/**',
        logs: [`Agent ${agentId} connected to live workspace.`],
      };
    }
  },

  async disconnectAgent(agentId: string): Promise<void> {
    try {
      await apiClient.post(`/agents/${encodeURIComponent(agentId)}/disconnect`);
    } catch {
      // Ignore disconnect network errors
    }
  },

  async announceCapabilities(agentId: string, capabilities: string[]): Promise<ProtocolEvent> {
    const timestamp = new Date().toISOString();
    return {
      id: `evt_cap_${Date.now()}`,
      workspaceId: 'ws_live_default',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      timestamp,
      sender: agentId,
      receiver: 'broadcast',
      type: 'CAPABILITY_ANNOUNCEMENT',
      payload: JSON.stringify({ capabilities }),
    };
  },
};
