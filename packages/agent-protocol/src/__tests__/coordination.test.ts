import { describe, it, expect } from 'vitest';
import {
  CoordinationMessageType,
  PROTOCOL_VERSION,
  parseCoordinationMessage,
  isCoordinationMessageType,
  redactSecrets,
  TERMINAL_MAX_CHUNK_BYTES,
} from '../index.js';

const envelope = (type: string, payload: unknown) => ({
  id: 'm1',
  protocolVersion: PROTOCOL_VERSION,
  projectId: 'p1',
  senderId: 'a1',
  timestamp: new Date().toISOString(),
  type,
  payload,
});

describe('coordination messages', () => {
  it('defaults a new terminal to PRIVATE', () => {
    const r = parseCoordinationMessage(envelope(CoordinationMessageType.TERMINAL_OPEN, { name: 'claude' }));
    expect(r.ok && r.message.type === 'terminal.open' && r.message.payload.visibility).toBe('PRIVATE');
  });

  it('rejects unknown fields, oversized chunks and bad visibility', () => {
    expect(parseCoordinationMessage(envelope('terminal.open', { name: 'x', env: { SECRET: 1 } })).ok).toBe(false);
    expect(parseCoordinationMessage(envelope('terminal.output', { terminalId: 't', data: 'x'.repeat(TERMINAL_MAX_CHUNK_BYTES + 1) })).ok).toBe(false);
    expect(parseCoordinationMessage(envelope('terminal.update', { terminalId: 't', visibility: 'PUBLIC' })).ok).toBe(false);
  });

  it('has no input message in the union', () => {
    expect(isCoordinationMessageType('terminal.input')).toBe(true); // known, so the server can refuse it explicitly
    expect(parseCoordinationMessage(envelope('terminal.input', { terminalId: 't', data: 'ls' })).ok).toBe(false);
  });

  it('does not claim core protocol types', () => {
    expect(isCoordinationMessageType('agent.handshake')).toBe(false);
  });
});

describe('redactSecrets', () => {
  it.each([
    ['export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz', 'export OPENAI_API_KEY=[redacted]'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB', 'token [redacted]'],
    ['AWS AKIAABCDEFGHIJKLMNOP', 'AWS [redacted]'],
    ['Authorization: Bearer abc.def.ghijklmnopqrstuvwxyz', 'Authorization: Bearer [redacted]'],
    ['postgres://user:hunter2pass@db:5432/x', 'postgres://user:[redacted]@db:5432/x'],
    ['PRIVATE_KEY=0x' + 'a'.repeat(64), 'PRIVATE_KEY=[redacted]'],
    ['connect --connect-token amct_abcdefghijklmnopqrstuvwxyz', 'connect --connect-token [redacted]'],
  ])('redacts %s', (input, expected) => {
    expect(redactSecrets(input).text).toBe(expected);
  });

  it('leaves ordinary output alone and names what matched', () => {
    expect(redactSecrets('npm test\n42 passing').text).toBe('npm test\n42 passing');
    expect(redactSecrets('-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----').matched).toContain('private-key-block');
  });
});
