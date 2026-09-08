import { describe, it, expect } from 'vitest';
import {
  createTaskAssignedMessage,
  parseAgentMeshMessage,
  AgentMeshMessageType,
  taskAssignedPayloadSchema,
} from '../index.js';

describe('PRD-14 Protocol Task Assigned Message Tests', () => {
  it('1. taskAssignedPayloadSchema validates valid payload', () => {
    const validPayload = {
      taskId: 'task-123',
      agentId: 'agent-456',
      assignmentSource: 'CAPABILITY_MATCH',
      score: 85,
      explanation: {
        matchedCapabilities: ['typescript', 'react'],
      },
    };

    const result = taskAssignedPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taskId).toBe('task-123');
      expect(result.data.assignmentSource).toBe('CAPABILITY_MATCH');
    }
  });

  it('2. taskAssignedPayloadSchema rejects invalid payload', () => {
    const invalidPayload = {
      taskId: '',
      agentId: 'agent-456',
      assignmentSource: 'INVALID_SOURCE',
    };

    const result = taskAssignedPayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it('3. createTaskAssignedMessage produces valid canonical protocol message', () => {
    const msg = createTaskAssignedMessage(
      {
        projectId: 'project-789',
        senderId: 'server',
      },
      {
        taskId: 'task-123',
        agentId: 'agent-456',
        assignmentSource: 'HUMAN_PREFERENCE',
      },
    );

    expect(msg.type).toBe(AgentMeshMessageType.TASK_ASSIGNED);
    expect(msg.projectId).toBe('project-789');
    expect(msg.payload.assignmentSource).toBe('HUMAN_PREFERENCE');

    const parsed = parseAgentMeshMessage(msg);
    expect(parsed.type).toBe(AgentMeshMessageType.TASK_ASSIGNED);
  });
});
