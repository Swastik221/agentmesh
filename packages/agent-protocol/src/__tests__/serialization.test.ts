import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  AgentMeshMessageType,
  AgentMeshMessage,
  serializeMessage,
  deserializeMessage,
  createTaskCompletedMessage,
} from '../index.js';

describe('PRD-12 - Deterministic Serialization Tests', () => {
  const sampleMessage = createTaskCompletedMessage(
    {
      id: 'msg-canon-100',
      projectId: 'proj-1',
      senderId: 'agent-1',
      recipientId: 'server',
      correlationId: 'corr-100',
      timestamp: '2026-09-08T12:00:00.000Z',
    },
    {
      taskId: 'task-100',
      executionId: 'exec-100',
      result: {
        summary: 'Completed',
        files: ['b.ts', 'a.ts'],
        meta: { z: 1, a: 2 },
      },
    },
  );

  it('produces byte-for-byte identical output regardless of property insertion order', () => {
    // Construct another object with scrambled key ordering
    const scrambledMessage = {
      timestamp: '2026-09-08T12:00:00.000Z',
      payload: {
        result: {
          meta: { a: 2, z: 1 },
          files: ['b.ts', 'a.ts'],
          summary: 'Completed',
        },
        executionId: 'exec-100',
        taskId: 'task-100',
      },
      kind: 'event',
      executionId: 'exec-100',
      taskId: 'task-100',
      correlationId: 'corr-100',
      recipientId: 'server',
      senderId: 'agent-1',
      projectId: 'proj-1',
      type: AgentMeshMessageType.TASK_COMPLETED,
      protocolVersion: PROTOCOL_VERSION,
      id: 'msg-canon-100',
    };

    const str1 = serializeMessage(sampleMessage);
    const str2 = serializeMessage(scrambledMessage as AgentMeshMessage);

    expect(str1).toBe(str2);
  });

  it('performs round-trip serialization and deserialization without loss of data', () => {
    const jsonString = serializeMessage(sampleMessage);
    const deserialized = deserializeMessage(jsonString);

    expect(deserialized.id).toBe(sampleMessage.id);
    expect(deserialized.type).toBe(sampleMessage.type);
    expect(deserialized.projectId).toBe(sampleMessage.projectId);
    expect(deserialized.payload).toEqual(sampleMessage.payload);
  });

  it('rejects deserialization of invalid JSON strings', () => {
    expect(() => deserializeMessage('not-valid-json')).toThrow();
  });
});
