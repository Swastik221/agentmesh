import { describe, it, expect } from 'vitest';
import {
  AgentMeshMessageType,
  isTerminalTaskMessageType,
  isValidTaskMessageTransition,
} from '../index.js';

describe('PRD-12 - Protocol Lifecycle Tests', () => {
  it('identifies terminal task message types correctly', () => {
    expect(isTerminalTaskMessageType(AgentMeshMessageType.TASK_COMPLETED)).toBe(true);
    expect(isTerminalTaskMessageType(AgentMeshMessageType.TASK_FAILED)).toBe(true);
    expect(isTerminalTaskMessageType(AgentMeshMessageType.TASK_REJECTED)).toBe(true);

    expect(isTerminalTaskMessageType(AgentMeshMessageType.TASK_REQUEST)).toBe(false);
    expect(isTerminalTaskMessageType(AgentMeshMessageType.TASK_ACCEPTED)).toBe(false);
    expect(isTerminalTaskMessageType(AgentMeshMessageType.TASK_PROGRESS)).toBe(false);
  });

  it('validates task message transition rules', () => {
    // Initial task message must be request or handshake
    expect(isValidTaskMessageTransition(null, AgentMeshMessageType.TASK_REQUEST)).toBe(true);

    // request -> accepted / rejected / failed
    expect(isValidTaskMessageTransition(AgentMeshMessageType.TASK_REQUEST, AgentMeshMessageType.TASK_ACCEPTED)).toBe(true);
    expect(isValidTaskMessageTransition(AgentMeshMessageType.TASK_REQUEST, AgentMeshMessageType.TASK_REJECTED)).toBe(true);
    expect(isValidTaskMessageTransition(AgentMeshMessageType.TASK_REQUEST, AgentMeshMessageType.TASK_FAILED)).toBe(true);

    // accepted -> progress / completed / failed / status
    expect(isValidTaskMessageTransition(AgentMeshMessageType.TASK_ACCEPTED, AgentMeshMessageType.TASK_PROGRESS)).toBe(true);
    expect(isValidTaskMessageTransition(AgentMeshMessageType.TASK_ACCEPTED, AgentMeshMessageType.TASK_COMPLETED)).toBe(true);

    // terminal states cannot transition to other task states
    expect(isValidTaskMessageTransition(AgentMeshMessageType.TASK_COMPLETED, AgentMeshMessageType.TASK_PROGRESS)).toBe(false);
    expect(isValidTaskMessageTransition(AgentMeshMessageType.TASK_FAILED, AgentMeshMessageType.TASK_ACCEPTED)).toBe(false);
  });
});
