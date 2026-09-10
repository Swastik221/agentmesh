import type { Agent, AgentConnectionAdapter, ProtocolEvent } from '../types';

export const INITIAL_DEMO_AGENTS: Agent[] = [
  {
    id: 'orion',
    name: 'Orion',
    provider: 'Codex',
    ownerId: 'anand',
    ownerName: 'Anand',
    ownerEns: 'dev1.eth',
    ownerColor: 'purple',
    ens: 'codex.dev1.eth',
    address: '0x91a3…b9f3c',
    capabilities: ['frontend', 'identity', 'API'],
    status: 'connected',
    repoScope: 'src/identity/**',
    logs: [
      'HELLO · codex.dev1.eth ready',
      'CAPABILITY_ANNOUNCEMENT · frontend, identity, API',
      'TASK_PREFERENCE · AM-114',
      'DEPENDENCY_REQUEST · payment-api.json',
    ],
  },
  {
    id: 'vega',
    name: 'Vega',
    provider: 'Claude',
    ownerId: 'swastik',
    ownerName: 'Swastik',
    ownerEns: 'dev2.eth',
    ownerColor: 'green',
    ens: 'claude.dev2.eth',
    address: '0x2e50…f8a1',
    capabilities: ['backend', 'Solidity', 'DevOps'],
    status: 'connected',
    repoScope: 'contracts/**',
    logs: [
      'HELLO · claude.dev2.eth connected',
      'CAPABILITY_ANNOUNCEMENT · backend, Solidity, DevOps',
      'TASK_PREFERENCE · AM-115',
      'ARTIFACT_PUBLISHED · payment-api.json',
    ],
  },
  {
    id: 'nova',
    name: 'Nova',
    provider: 'Gemini',
    ownerId: 'anand',
    ownerName: 'Anand',
    ownerEns: 'dev1.eth',
    ownerColor: 'purple',
    ens: 'gemini.dev1.eth',
    address: '0x4d38…7a19',
    capabilities: ['API', 'DevOps', 'Solidity'],
    status: 'idle',
    repoScope: 'packages/agent-protocol/**',
    logs: [
      'HELLO · gemini.dev1.eth connected',
      'CAPABILITY_ANNOUNCEMENT · API, DevOps, Solidity',
    ],
  },
];

export class DemoAgentConnectionAdapter implements AgentConnectionAdapter {
  private agents: Map<string, Agent> = new Map(INITIAL_DEMO_AGENTS.map((a) => [a.id, { ...a }]));

  async getAvailableAgents(): Promise<Agent[]> {
    return Array.from(this.agents.values());
  }

  async connectAgent(agentId: string, options?: { provider?: string; repoScope?: string }): Promise<Agent> {
    const existing = this.agents.get(agentId);
    if (existing) {
      existing.status = 'connected';
      if (options?.provider) existing.provider = options.provider;
      if (options?.repoScope) existing.repoScope = options.repoScope;
      return { ...existing };
    }
    const newAgent: Agent = {
      id: agentId,
      name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
      provider: options?.provider ?? 'Codex',
      ownerId: 'anand',
      ownerName: 'Anand',
      ownerEns: 'dev1.eth',
      ownerColor: 'purple',
      ens: `${agentId}.dev1.eth`,
      address: `0x${Math.random().toString(16).substring(2, 10)}…${Math.random().toString(16).substring(2, 6)}`,
      capabilities: ['frontend', 'API'],
      status: 'connected',
      repoScope: options?.repoScope ?? 'src/**',
      logs: [`HELLO · ${agentId} connected to AgentMesh`],
    };
    this.agents.set(agentId, newAgent);
    return newAgent;
  }

  async disconnectAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'offline';
    }
  }

  async announceCapabilities(agentId: string, capabilities: string[]): Promise<ProtocolEvent> {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.capabilities = capabilities;
      agent.logs.push(`CAPABILITY_ANNOUNCEMENT · ${capabilities.join(', ')}`);
    }
    return {
      id: `ev-cap-${Date.now()}`,
      workspaceId: 'checkout-demo',
      time: new Date().toLocaleTimeString([], { hour12: false }),
      timestamp: new Date().toISOString(),
      sender: agent?.name ?? agentId,
      receiver: 'Mesh Coordinator',
      type: 'CAPABILITY_ANNOUNCEMENT',
      payload: capabilities.join(', '),
    };
  }
}
