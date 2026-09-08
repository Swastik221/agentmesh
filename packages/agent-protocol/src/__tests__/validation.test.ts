import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  AgentMeshMessageType,
  parseAgentMeshMessage,
  AgentMeshProtocolError,
  AgentMeshProtocolErrorCode,
} from '../index.js';

describe('PRD-12 - Runtime Protocol Validation Tests', () => {
  const baseEnvelope = {
    id: 'msg-valid-1',
    protocolVersion: PROTOCOL_VERSION,
    projectId: 'proj-1',
    senderId: 'agent-1',
    timestamp: new Date().toISOString(),
  };

  it('validates every canonical payload type', () => {
    const validMessages = [
      {
        ...baseEnvelope,
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        payload: { agentId: 'agent-1', capabilities: ['ts'] },
      },
      {
        ...baseEnvelope,
        type: AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED,
        payload: { agentId: 'agent-1', sessionId: 'sess-1', projectId: 'proj-1', capabilities: ['ts'] },
      },
      {
        ...baseEnvelope,
        type: AgentMeshMessageType.AGENT_HANDSHAKE_REJECTED,
        payload: { code: 'UNAUTHORIZED', message: 'Denied' },
      },
      {
        ...baseEnvelope,
        type: AgentMeshMessageType.TASK_ACCEPTED,
        payload: { taskId: 'task-1' },
      },
      {
        ...baseEnvelope,
        type: AgentMeshMessageType.TASK_COMPLETED,
        payload: { taskId: 'task-1', result: { status: 'success' } },
      },
      {
        ...baseEnvelope,
        type: AgentMeshMessageType.TASK_FAILED,
        payload: { taskId: 'task-1', error: 'Syntax error' },
      },
      {
        ...baseEnvelope,
        type: AgentMeshMessageType.PING,
        payload: {},
      },
      {
        ...baseEnvelope,
        type: AgentMeshMessageType.PONG,
        payload: {},
      },
    ];

    for (const msg of validMessages) {
      expect(() => parseAgentMeshMessage(msg)).not.toThrow();
    }
  });

  it('rejects unsupported protocol version', () => {
    const msg = {
      ...baseEnvelope,
      protocolVersion: '99.0',
      type: AgentMeshMessageType.AGENT_STATUS,
      payload: { status: 'ONLINE' },
    };

    try {
      parseAgentMeshMessage(msg);
      expect.fail('Should have thrown unsupported version error');
    } catch (err: unknown) {
      expect((err as AgentMeshProtocolError).code).toBe(
        AgentMeshProtocolErrorCode.INVALID_VERSION,
      );
    }
  });

  it('rejects unknown message type', () => {
    const msg = {
      ...baseEnvelope,
      type: 'invalid.message.type',
      payload: {},
    };

    try {
      parseAgentMeshMessage(msg);
      expect.fail('Should have thrown unknown message type error');
    } catch (err: unknown) {
      expect((err as AgentMeshProtocolError).code).toBe(
        AgentMeshProtocolErrorCode.UNKNOWN_MESSAGE_TYPE,
      );
    }
  });

  it('rejects invalid payload for known message type', () => {
    const msg = {
      ...baseEnvelope,
      type: AgentMeshMessageType.TASK_FAILED,
      payload: { taskId: 'task-1' }, // Missing required 'error' string
    };

    try {
      parseAgentMeshMessage(msg);
      expect.fail('Should have thrown invalid payload error');
    } catch (err: unknown) {
      expect((err as AgentMeshProtocolError).code).toBe(
        AgentMeshProtocolErrorCode.INVALID_PAYLOAD,
      );
    }
  });

  it('rejects non-object raw input safely without crashing', () => {
    expect(() => parseAgentMeshMessage(null)).toThrow();
    expect(() => parseAgentMeshMessage('string')).toThrow();
    expect(() => parseAgentMeshMessage(12345)).toThrow();
  });
});
