import { describe, it, expect } from 'vitest';
import { AgentNode, toCanvasAgent, type CanvasAgent } from '../AgentNode';
import type { LiveAgent } from '../../../../adapters/live/agent.adapter';

/**
 * Regression coverage for the workboard white-screen.
 *
 * A real agent row rendered on the canvas used to throw inside AgentNode and
 * unmount the whole app, because the node data was built without `logs` and
 * the component read `agent.logs.slice(-4)` unguarded. These tests run the
 * real mapper the canvas uses, not a hand-built literal, so they fail if the
 * mapping and the component ever drift apart again.
 */
describe('AgentNode & Workboard Agent Contract Regression Tests', () => {
  const freshlyRegistered: LiveAgent = {
    // Exactly what POST /projects/:id/agents returns for a brand new agent:
    // no ENS, no wallet, no capabilities, OFFLINE. This is the shape that
    // crashed the canvas.
    id: 'ag_fresh_001',
    projectId: 'proj_live_456',
    ownerId: 'usr_owner_789',
    name: 'Orion',
    provider: 'Codex',
    status: 'OFFLINE',
    ensName: null,
    ensAddress: null,
    ensVerifiedAt: null,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
  };

  const linkedAndOnline: LiveAgent = {
    ...freshlyRegistered,
    id: 'ag_real_123',
    status: 'ONLINE',
    ensName: 'codex.eth',
    ensAddress: '0x1234567890123456789012345678901234567890',
    ensVerifiedAt: '2026-01-01T00:00:00.000Z',
    capabilities: [
      { id: 'cap_1', agentId: 'ag_real_123', capability: 'code-review' },
      { id: 'cap_2', agentId: 'ag_real_123', capability: 'security-audit' },
    ],
  };

  it('1. maps a freshly registered agent (no ENS, no capabilities) into node data the component can render', () => {
    const agent = toCanvasAgent(freshlyRegistered, null);

    expect(agent.logs).toBeDefined();
    expect(Array.isArray(agent.logs)).toBe(true);
    expect(() => (agent.logs ?? []).slice(-4)).not.toThrow();
    expect(agent.capabilities).toEqual([]);
    // Absent identity stays absent. Nothing is invented to look populated.
    expect(agent.ens).toBeNull();
    expect(agent.address).toBeNull();
    expect(agent.status).toBe('OFFLINE');
  });

  it('2. maps a linked, online agent with capabilities and keeps the backend status verbatim', () => {
    const agent = toCanvasAgent(linkedAndOnline, 'someone_else');

    expect(agent.status).toBe('ONLINE');
    expect(agent.ens).toBe('codex.eth');
    expect(agent.address).toBe('0x1234567890123456789012345678901234567890');
    expect(agent.capabilities).toEqual(['code-review', 'security-audit']);
    expect(agent.ownedByViewer).toBe(false);
    expect(agent.ownerLabel).toBe('usr_owner_789');
  });

  it('3. labels an agent the signed-in user owns as theirs', () => {
    const agent = toCanvasAgent(linkedAndOnline, 'usr_owner_789');

    expect(agent.ownedByViewer).toBe(true);
    expect(agent.ownerLabel).toBe('you');
  });

  it('4. the component tolerates node data with every optional field missing', () => {
    // The narrowest shape the type permits. If AgentNode ever reads an
    // optional field without a guard, calling it will throw here.
    const minimal: CanvasAgent = {
      id: 'ag_min',
      name: 'Min',
      provider: 'p',
      status: 'OFFLINE',
    };
    const props = {
      id: 'ag_min',
      data: { agent: minimal },
      selected: false,
      type: 'productAgent',
      dragging: false,
      zIndex: 0,
      isConnectable: false,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      deletable: false,
      selectable: false,
      draggable: false,
    };
    expect(() => AgentNode(props as never)).not.toThrow();
  });

  it('5. the component returns null rather than throwing when node data has no agent at all', () => {
    expect(AgentNode({ data: {} } as never)).toBeNull();
  });
});
