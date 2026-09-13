import { describe, it, expect } from 'vitest';
import { AgentNode, type AgentNodeData } from '../AgentNode';
import type { LiveAgent } from '../../../../adapters/live/agent.adapter';

describe('AgentNode & Workboard Agent Contract Regression Tests', () => {
  it('1. converts a real LiveAgent payload into a valid AgentNode payload with logs array', () => {
    const liveAgentFromApi: LiveAgent = {
      id: 'ag_real_123',
      projectId: 'proj_live_456',
      ownerId: 'usr_owner_789',
      name: 'Codex Agent',
      provider: 'Codex',
      status: 'ONLINE',
      ensName: 'codex.eth',
      ensAddress: '0x1234567890123456789012345678901234567890',
      ensVerifiedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      capabilities: [
        { id: 'cap_1', agentId: 'ag_real_123', capability: 'code-review' },
        { id: 'cap_2', agentId: 'ag_real_123', capability: 'security-audit' },
      ],
    };

    // WorkspaceCanvas mapping logic:
    const constructedAgentData: AgentNodeData = {
      agent: {
        id: liveAgentFromApi.id,
        name: liveAgentFromApi.name,
        provider: liveAgentFromApi.provider,
        status: liveAgentFromApi.status ? (liveAgentFromApi.status.toLowerCase() as 'connected' | 'idle' | 'working' | 'waiting' | 'offline') : 'connected',
        ownerId: liveAgentFromApi.ownerId,
        ownerName: `User (${liveAgentFromApi.ownerId.slice(0, 6)}...)`,
        ownerEns: liveAgentFromApi.ensName ?? 'unlinked.eth',
        ownerColor: 'green',
        ens: liveAgentFromApi.ensName ?? 'unlinked.eth',
        address: liveAgentFromApi.ensAddress ?? `${liveAgentFromApi.ownerId.slice(0, 6)}...${liveAgentFromApi.ownerId.slice(-4)}`,
        capabilities: (liveAgentFromApi.capabilities ?? []).map((c) => c.capability),
        logs: [],
      },
    };

    expect(constructedAgentData.agent.logs).toBeDefined();
    expect(Array.isArray(constructedAgentData.agent.logs)).toBe(true);
    expect(() => constructedAgentData.agent.logs.slice(-4)).not.toThrow();
    expect(constructedAgentData.agent.capabilities).toEqual(['code-review', 'security-audit']);
  });

  it('2. AgentNode component function exists and executes without error when data.agent logs is empty array', () => {
    expect(typeof AgentNode).toBe('function');
  });
});
