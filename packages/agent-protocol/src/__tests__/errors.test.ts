import { describe, it, expect } from 'vitest';
import {
  AgentMeshProtocolError,
  AgentMeshProtocolErrorCode,
} from '../index.js';

describe('PRD-12 - Protocol Errors Tests', () => {
  it('instantiates AgentMeshProtocolError with default and custom error codes', () => {
    const errDefault = new AgentMeshProtocolError('Default error');
    expect(errDefault.code).toBe(AgentMeshProtocolErrorCode.INVALID_MESSAGE);
    expect(errDefault.retryable).toBe(false);

    const errCustom = new AgentMeshProtocolError('Unauthorized access', AgentMeshProtocolErrorCode.UNAUTHORIZED, {
      retryable: true,
      correlationId: 'corr-999',
      details: { reason: 'Invalid session' },
    });

    expect(errCustom.code).toBe('UNAUTHORIZED');
    expect(errCustom.retryable).toBe(true);
    expect(errCustom.correlationId).toBe('corr-999');
    expect(errCustom.details).toEqual({ reason: 'Invalid session' });
  });

  it('serializes to structured JSON via toJSON() method', () => {
    const err = new AgentMeshProtocolError('Task not found', AgentMeshProtocolErrorCode.TASK_NOT_FOUND, {
      correlationId: 'corr-123',
    });

    const json = err.toJSON();
    expect(json.code).toBe('TASK_NOT_FOUND');
    expect(json.message).toBe('Task not found');
    expect(json.retryable).toBe(false);
    expect(json.correlationId).toBe('corr-123');
  });
});
