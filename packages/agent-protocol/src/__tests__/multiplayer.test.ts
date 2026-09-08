import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  AgentMeshMessageType,
  parseAgentMeshMessage,
  serializeMessage,
  deserializeMessage,
  createWorkspaceSnapshotMessage,
  createWorkspacePresenceChangedMessage,
} from '../index.js';

describe('PRD-13 - Multiplayer Protocol Messages', () => {
  const baseOptions = {
    id: 'msg-ws-100',
    projectId: 'proj-001',
    senderId: 'server',
    timestamp: new Date().toISOString(),
  };

  it('builds, validates, and serializes a workspace.snapshot message', () => {
    const snapshotPayload = {
      workspace: {
        id: 'proj-001',
        name: 'Test Project',
      },
      members: [
        {
          userId: 'user-1',
          displayName: 'Alice',
          walletAddress: '0x123',
          role: 'OWNER',
          status: 'ONLINE' as const,
        },
        {
          userId: 'user-2',
          displayName: 'Bob',
          role: 'MEMBER',
          status: 'OFFLINE' as const,
        },
      ],
      agents: [
        {
          agentId: 'agent-1',
          name: 'CoderAgent',
          ownerId: 'user-1',
          provider: 'CLAUDE',
          status: 'ONLINE' as const,
        },
      ],
      tasks: [
        {
          taskId: 'task-1',
          title: 'Implement multiplayer',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
        },
      ],
    };

    const msg = createWorkspaceSnapshotMessage(baseOptions, snapshotPayload);

    expect(msg.type).toBe(AgentMeshMessageType.WORKSPACE_SNAPSHOT);
    expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(msg.payload.members.length).toBe(2);

    const parsed = parseAgentMeshMessage(msg);
    expect(parsed.type).toBe(AgentMeshMessageType.WORKSPACE_SNAPSHOT);

    const serialized = serializeMessage(msg);
    const deserialized = deserializeMessage(serialized);
    expect(deserialized.type).toBe(AgentMeshMessageType.WORKSPACE_SNAPSHOT);
    expect(deserialized.id).toBe('msg-ws-100');
  });

  it('builds, validates, and serializes a workspace.presence.changed message', () => {
    const presencePayload = {
      entityType: 'user' as const,
      entityId: 'user-1',
      status: 'ONLINE' as const,
      metadata: { displayName: 'Alice' },
    };

    const msg = createWorkspacePresenceChangedMessage(baseOptions, presencePayload);

    expect(msg.type).toBe(AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED);
    expect(msg.payload.entityType).toBe('user');
    expect(msg.payload.status).toBe('ONLINE');

    const parsed = parseAgentMeshMessage(msg);
    expect(parsed.type).toBe(AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED);

    const serialized = serializeMessage(msg);
    const deserialized = deserializeMessage(serialized);
    expect(deserialized.type).toBe(AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED);
  });
});
