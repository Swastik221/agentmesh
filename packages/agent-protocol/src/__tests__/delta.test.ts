import { describe, it, expect } from 'vitest';
import {
  AgentMeshMessageType,
  PROTOCOL_VERSION,
  createWorkspaceDeltaMessage,
  createWorkspaceResyncRequestMessage,
  createWorkspaceResyncRequiredMessage,
  createWorkspaceSnapshotMessage,
  agentMeshMessageSchema,
  workspaceDeltaPayloadSchema,
} from '../index.js';

describe('PRD-16 Agent Protocol Delta-State Broadcast Schemas & Builders', () => {
  it('1. Validates workspace.delta message envelope and payload', () => {
    const msg = createWorkspaceDeltaMessage(
      {
        projectId: 'proj-123',
        senderId: 'server',
      },
      {
        sequence: 42,
        changes: [
          {
            entity: 'agent',
            entityId: 'agent-456',
            operation: 'updated',
            fields: { status: 'ONLINE' },
          },
        ],
      },
    );

    expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(msg.type).toBe(AgentMeshMessageType.WORKSPACE_DELTA);
    expect(msg.payload.sequence).toBe(42);
    expect(msg.payload.changes.length).toBe(1);

    const parsed = agentMeshMessageSchema.safeParse(msg);
    expect(parsed.success).toBe(true);
  });

  it('2. Rejects workspace.delta with non-positive sequence', () => {
    const invalidPayload = {
      sequence: 0,
      changes: [
        {
          entity: 'task',
          entityId: 'task-1',
          operation: 'updated',
        },
      ],
    };

    const res = workspaceDeltaPayloadSchema.safeParse(invalidPayload);
    expect(res.success).toBe(false);
  });

  it('3. Rejects workspace.delta with empty changes array', () => {
    const invalidPayload = {
      sequence: 1,
      changes: [],
    };

    const res = workspaceDeltaPayloadSchema.safeParse(invalidPayload);
    expect(res.success).toBe(false);
  });

  it('4. Validates workspace.resync.request message', () => {
    const msg = createWorkspaceResyncRequestMessage(
      {
        projectId: 'proj-123',
        senderId: 'user-789',
      },
      {
        lastKnownSequence: 10,
        reason: 'SEQUENCE_GAP',
      },
    );

    expect(msg.type).toBe(AgentMeshMessageType.WORKSPACE_RESYNC_REQUEST);
    expect(msg.payload.lastKnownSequence).toBe(10);
    expect(msg.payload.reason).toBe('SEQUENCE_GAP');

    const parsed = agentMeshMessageSchema.safeParse(msg);
    expect(parsed.success).toBe(true);
  });

  it('5. Validates workspace.resync.required message', () => {
    const msg = createWorkspaceResyncRequiredMessage(
      {
        projectId: 'proj-123',
        senderId: 'server',
      },
      {
        sequence: 50,
        reason: 'Sequence gap unrecoverable',
      },
    );

    expect(msg.type).toBe(AgentMeshMessageType.WORKSPACE_RESYNC_REQUIRED);
    expect(msg.payload.sequence).toBe(50);

    const parsed = agentMeshMessageSchema.safeParse(msg);
    expect(parsed.success).toBe(true);
  });

  it('6. Workspace snapshot includes optional sequence field', () => {
    const msg = createWorkspaceSnapshotMessage(
      {
        projectId: 'proj-123',
        senderId: 'server',
      },
      {
        workspace: { id: 'proj-123', name: 'Test Proj' },
        sequence: 100,
        members: [],
        agents: [],
        tasks: [],
      },
    );

    expect(msg.payload.sequence).toBe(100);
    const parsed = agentMeshMessageSchema.safeParse(msg);
    expect(parsed.success).toBe(true);
  });
});
