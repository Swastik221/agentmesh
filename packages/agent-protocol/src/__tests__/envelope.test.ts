import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  AgentMeshMessageType,
  parseAgentMeshMessage,
  createTaskRequestMessage,
  ParticipantType,
  MessageKind,
} from '../index.js';

describe('PRD-12 - Canonical Envelope Tests', () => {
  const baseValidEnvelope = {
    id: 'msg-uuid-100',
    protocolVersion: PROTOCOL_VERSION,
    projectId: 'proj-001',
    senderId: 'agent-1',
    timestamp: new Date().toISOString(),
  };

  it('validates a complete canonical envelope with participants, correlationId, and causationId', () => {
    const msg = {
      ...baseValidEnvelope,
      type: AgentMeshMessageType.TASK_REQUEST,
      sender: { type: ParticipantType.AGENT, id: 'agent-1' },
      recipient: { type: ParticipantType.SERVER, id: 'server' },
      correlationId: 'corr-001',
      causationId: 'cause-000',
      taskId: 'task-001',
      executionId: 'exec-001',
      kind: MessageKind.REQUEST,
      payload: {
        taskId: 'task-001',
        title: 'Run task',
        description: 'Execute build step',
      },
    };

    const parsed = parseAgentMeshMessage(msg);
    expect(parsed.id).toBe('msg-uuid-100');
    expect(parsed.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(parsed.senderId).toBe('agent-1');
    expect(parsed.sender?.type).toBe('agent');
    expect(parsed.recipient?.type).toBe('server');
    expect(parsed.correlationId).toBe('corr-001');
    expect(parsed.causationId).toBe('cause-000');
    expect(parsed.taskId).toBe('task-001');
    expect(parsed.executionId).toBe('exec-001');
    expect(parsed.kind).toBe('request');
  });

  it('rejects envelope missing required id', () => {
    const invalid = {
      ...baseValidEnvelope,
      id: '',
      type: AgentMeshMessageType.AGENT_STATUS,
      payload: { status: 'ONLINE' },
    };
    expect(() => parseAgentMeshMessage(invalid)).toThrow(/Message ID is required|Invalid message field/);
  });

  it('rejects envelope with missing or invalid timestamp', () => {
    const invalid = {
      ...baseValidEnvelope,
      timestamp: 'not-a-date',
      type: AgentMeshMessageType.AGENT_STATUS,
      payload: { status: 'ONLINE' },
    };
    expect(() => parseAgentMeshMessage(invalid)).toThrow(/Timestamp must be a valid ISO-8601/);
  });

  it('rejects envelope missing projectId', () => {
    const invalid = {
      ...baseValidEnvelope,
      projectId: '',
      type: AgentMeshMessageType.AGENT_STATUS,
      payload: { status: 'ONLINE' },
    };
    expect(() => parseAgentMeshMessage(invalid)).toThrow(/Project ID is required/);
  });

  it('automatically populates envelope fields when created with builder', () => {
    const built = createTaskRequestMessage(
      {
        projectId: 'proj-1',
        senderId: 'user-1',
        recipientId: 'agent-1',
        correlationId: 'corr-77',
      },
      {
        taskId: 'task-77',
        title: 'Title',
        description: 'Description',
      },
    );

    expect(built.id).toBeDefined();
    expect(built.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(built.kind).toBe('request');
    expect(built.taskId).toBe('task-77');
  });
});
