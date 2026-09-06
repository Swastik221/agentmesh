import { describe, it, expect } from 'vitest';
import {
  AGENTMESH_PROTOCOL_VERSION,
  AgentMeshMessageType,
  AgentMeshProtocolError,
  AgentMeshProtocolErrorCode,
  parseAgentMeshMessage,
  isAgentMeshMessage,
  createAgentMeshMessage,
} from '../index.js';

describe('AgentMesh Protocol v0.1 Tests', () => {
  const baseValidEnvelope = {
    id: 'msg-uuid-1234',
    protocolVersion: AGENTMESH_PROTOCOL_VERSION,
    projectId: 'proj-123',
    senderId: 'agent-1',
    timestamp: new Date().toISOString(),
  };

  describe('Valid Messages Parsing', () => {
    it('should validate valid agent.status message', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.AGENT_STATUS,
        payload: { status: 'ONLINE' },
      };
      const parsed = parseAgentMeshMessage(msg);
      expect(parsed.type).toBe('agent.status');
      if (parsed.type === 'agent.status') {
        expect(parsed.payload.status).toBe('ONLINE');
      }
      expect(isAgentMeshMessage(msg)).toBe(true);
    });

    it('should validate valid agent.message', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.AGENT_MESSAGE,
        recipientId: 'agent-2',
        correlationId: 'corr-555',
        payload: {
          body: 'Hello Agent B!',
          metadata: { priority: 'high' },
        },
      };
      const parsed = parseAgentMeshMessage(msg);
      expect(parsed.type).toBe('agent.message');
      expect(parsed.recipientId).toBe('agent-2');
      expect(parsed.correlationId).toBe('corr-555');
      if (parsed.type === 'agent.message') {
        expect(parsed.payload.body).toBe('Hello Agent B!');
      }
      expect(isAgentMeshMessage(msg)).toBe(true);
    });

    it('should validate valid task.request and normalize capabilities', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.TASK_REQUEST,
        payload: {
          taskId: 'task-1',
          title: 'Build API',
          description: 'Create backend REST API',
          requiredCapabilities: [' Backend ', 'backend', 'Testing'],
          metadata: { scope: 'server' },
        },
      };
      const parsed = parseAgentMeshMessage(msg);
      expect(parsed.type).toBe('task.request');
      if (parsed.type === 'task.request') {
        expect(parsed.payload.requiredCapabilities).toEqual(['backend', 'testing']);
      }
    });

    it('should validate valid task.accepted', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.TASK_ACCEPTED,
        payload: { taskId: 'task-1' },
      };
      const parsed = parseAgentMeshMessage(msg);
      expect(parsed.type).toBe('task.accepted');
    });

    it('should validate valid task.rejected', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.TASK_REJECTED,
        payload: { taskId: 'task-1', reason: 'Agent is busy' },
      };
      const parsed = parseAgentMeshMessage(msg);
      expect(parsed.type).toBe('task.rejected');
    });

    it('should validate valid task.progress', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.TASK_PROGRESS,
        payload: { taskId: 'task-1', progress: 50, message: 'Halfway done' },
      };
      const parsed = parseAgentMeshMessage(msg);
      expect(parsed.type).toBe('task.progress');
      if (parsed.type === 'task.progress') {
        expect(parsed.payload.progress).toBe(50);
      }
    });

    it('should validate valid task.completed', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.TASK_COMPLETED,
        payload: { taskId: 'task-1', result: { status: 'success', data: [1, 2, 3] } },
      };
      const parsed = parseAgentMeshMessage(msg);
      expect(parsed.type).toBe('task.completed');
    });

    it('should validate valid task.failed', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.TASK_FAILED,
        payload: { taskId: 'task-1', error: 'Database connection failed', retryable: true },
      };
      const parsed = parseAgentMeshMessage(msg);
      expect(parsed.type).toBe('task.failed');
    });

    it('should validate valid error message', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.ERROR,
        payload: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
          retryable: true,
          details: { retryAfterMs: 5000 },
        },
      };
      const parsed = parseAgentMeshMessage(msg);
      expect(parsed.type).toBe('error');
    });
  });

  describe('Invalid Message Envelope', () => {
    it('should throw INVALID_MESSAGE if input is not an object', () => {
      expect(() => parseAgentMeshMessage('invalid string')).toThrow(AgentMeshProtocolError);
      try {
        parseAgentMeshMessage(null);
      } catch (err) {
        expect(err).toBeInstanceOf(AgentMeshProtocolError);
        expect((err as AgentMeshProtocolError).code).toBe(
          AgentMeshProtocolErrorCode.INVALID_MESSAGE,
        );
      }
    });

    it('should throw INVALID_MESSAGE if id is missing', () => {
      const msg = {
        ...baseValidEnvelope,
        id: '',
        type: AgentMeshMessageType.AGENT_STATUS,
        payload: { status: 'ONLINE' },
      };
      expect(() => parseAgentMeshMessage(msg)).toThrow(AgentMeshProtocolError);
      expect(isAgentMeshMessage(msg)).toBe(false);
    });

    it('should throw INVALID_MESSAGE if projectId is missing', () => {
      const msg = {
        ...baseValidEnvelope,
        projectId: '',
        type: AgentMeshMessageType.AGENT_STATUS,
        payload: { status: 'ONLINE' },
      };
      expect(() => parseAgentMeshMessage(msg)).toThrow(AgentMeshProtocolError);
    });

    it('should throw INVALID_MESSAGE if senderId is missing', () => {
      const msg = {
        ...baseValidEnvelope,
        senderId: '',
        type: AgentMeshMessageType.AGENT_STATUS,
        payload: { status: 'ONLINE' },
      };
      expect(() => parseAgentMeshMessage(msg)).toThrow(AgentMeshProtocolError);
    });

    it('should throw INVALID_MESSAGE if timestamp is not valid ISO-8601', () => {
      const msg = {
        ...baseValidEnvelope,
        timestamp: 'invalid-date',
        type: AgentMeshMessageType.AGENT_STATUS,
        payload: { status: 'ONLINE' },
      };
      expect(() => parseAgentMeshMessage(msg)).toThrow(AgentMeshProtocolError);
    });
  });

  describe('Protocol Version Validation', () => {
    it('should throw INVALID_VERSION for unsupported protocol version', () => {
      const msg = {
        ...baseValidEnvelope,
        protocolVersion: '0.2',
        type: AgentMeshMessageType.AGENT_STATUS,
        payload: { status: 'ONLINE' },
      };
      try {
        parseAgentMeshMessage(msg);
      } catch (err) {
        expect(err).toBeInstanceOf(AgentMeshProtocolError);
        expect((err as AgentMeshProtocolError).code).toBe(
          AgentMeshProtocolErrorCode.INVALID_VERSION,
        );
      }
    });

    it('should throw INVALID_MESSAGE if protocolVersion field is missing', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.AGENT_STATUS,
        payload: { status: 'ONLINE' },
      };
      delete (msg as Record<string, unknown>).protocolVersion;
      try {
        parseAgentMeshMessage(msg);
      } catch (err) {
        expect(err).toBeInstanceOf(AgentMeshProtocolError);
        expect((err as AgentMeshProtocolError).code).toBe(
          AgentMeshProtocolErrorCode.INVALID_MESSAGE,
        );
      }
    });
  });

  describe('Message Type Validation', () => {
    it('should throw UNKNOWN_MESSAGE_TYPE for unknown message type string', () => {
      const msg = {
        ...baseValidEnvelope,
        type: 'custom.unsupported.type',
        payload: {},
      };
      try {
        parseAgentMeshMessage(msg);
      } catch (err) {
        expect(err).toBeInstanceOf(AgentMeshProtocolError);
        expect((err as AgentMeshProtocolError).code).toBe(
          AgentMeshProtocolErrorCode.UNKNOWN_MESSAGE_TYPE,
        );
      }
    });
  });

  describe('Payload Validation', () => {
    it('should throw INVALID_PAYLOAD for invalid status in agent.status', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.AGENT_STATUS,
        payload: { status: 'INVALID_STATUS' },
      };
      try {
        parseAgentMeshMessage(msg);
      } catch (err) {
        expect(err).toBeInstanceOf(AgentMeshProtocolError);
        expect((err as AgentMeshProtocolError).code).toBe(
          AgentMeshProtocolErrorCode.INVALID_PAYLOAD,
        );
      }
    });

    it('should throw INVALID_PAYLOAD for empty body in agent.message', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.AGENT_MESSAGE,
        payload: { body: '   ' },
      };
      expect(() => parseAgentMeshMessage(msg)).toThrow(AgentMeshProtocolError);
    });

    it('should throw INVALID_PAYLOAD for progress < 0 or > 100 in task.progress', () => {
      const msgNegative = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.TASK_PROGRESS,
        payload: { taskId: 'task-1', progress: -5 },
      };
      expect(() => parseAgentMeshMessage(msgNegative)).toThrow(AgentMeshProtocolError);

      const msgOver = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.TASK_PROGRESS,
        payload: { taskId: 'task-1', progress: 105 },
      };
      expect(() => parseAgentMeshMessage(msgOver)).toThrow(AgentMeshProtocolError);
    });

    it('should throw INVALID_PAYLOAD for empty rejection reason in task.rejected', () => {
      const msg = {
        ...baseValidEnvelope,
        type: AgentMeshMessageType.TASK_REJECTED,
        payload: { taskId: 'task-1', reason: '' },
      };
      expect(() => parseAgentMeshMessage(msg)).toThrow(AgentMeshProtocolError);
    });
  });

  describe('Message Creation Helper (createAgentMeshMessage)', () => {
    it('should auto-generate id, protocolVersion, and timestamp when omitted', () => {
      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.TASK_REQUEST,
        projectId: 'p100',
        senderId: 'a100',
        payload: {
          taskId: 't-100',
          title: 'Helper Task',
          description: 'Testing helper',
        },
      });

      expect(msg.id).toBeDefined();
      expect(typeof msg.id).toBe('string');
      expect(msg.protocolVersion).toBe('0.1');
      expect(msg.timestamp).toBeDefined();
      expect(new Date(msg.timestamp).toString()).not.toBe('Invalid Date');
      expect(msg.type).toBe('task.request');
      expect(msg.projectId).toBe('p100');
      expect(msg.senderId).toBe('a100');
    });

    it('should preserve optional fields recipientId and correlationId if provided', () => {
      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: 'p100',
        senderId: 'a100',
        recipientId: 'a200',
        correlationId: 'c123',
        payload: { body: 'Hello' },
      });

      expect(msg.recipientId).toBe('a200');
      expect(msg.correlationId).toBe('c123');
    });

    it('should fail creation if payload is invalid', () => {
      expect(() =>
        createAgentMeshMessage({
          type: AgentMeshMessageType.TASK_REJECTED,
          projectId: 'p100',
          senderId: 'a100',
          payload: { taskId: 't-1', reason: '' },
        }),
      ).toThrow(AgentMeshProtocolError);
    });
  });
});
