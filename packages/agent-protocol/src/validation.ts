import crypto from 'node:crypto';
import { PROTOCOL_VERSION, AgentMeshMessageType } from './constants.js';
import { AgentMeshProtocolError, AgentMeshProtocolErrorCode } from './errors.js';
import { agentMeshMessageSchema } from './schemas.js';
import { AgentMeshMessage } from './types.js';

export function parseAgentMeshMessage(input: unknown): AgentMeshMessage {
  if (typeof input !== 'object' || input === null) {
    throw new AgentMeshProtocolError(
      'Message must be a non-null object',
      AgentMeshProtocolErrorCode.INVALID_MESSAGE,
    );
  }

  const raw = input as Record<string, unknown>;

  if (!raw.protocolVersion || typeof raw.protocolVersion !== 'string') {
    throw new AgentMeshProtocolError(
      'Missing protocolVersion',
      AgentMeshProtocolErrorCode.INVALID_MESSAGE,
    );
  }

  if (raw.protocolVersion !== PROTOCOL_VERSION) {
    throw new AgentMeshProtocolError(
      `Unsupported protocol version '${raw.protocolVersion}'. Expected '${PROTOCOL_VERSION}'`,
      AgentMeshProtocolErrorCode.INVALID_VERSION,
    );
  }

  if (!raw.type || typeof raw.type !== 'string') {
    throw new AgentMeshProtocolError(
      'Missing message type',
      AgentMeshProtocolErrorCode.INVALID_MESSAGE,
    );
  }

  const validTypes = Object.values(AgentMeshMessageType);
  if (!validTypes.includes(raw.type as AgentMeshMessageType)) {
    throw new AgentMeshProtocolError(
      `Unknown message type '${raw.type}'`,
      AgentMeshProtocolErrorCode.UNKNOWN_MESSAGE_TYPE,
    );
  }

  const parseResult = agentMeshMessageSchema.safeParse(input);
  if (!parseResult.success) {
    const issue = parseResult.error.issues[0];
    const path = issue.path.join('.');

    if (path.startsWith('payload') || issue.code === 'invalid_union') {
      throw new AgentMeshProtocolError(
        `Invalid payload for message type '${raw.type}': ${issue.message}`,
        AgentMeshProtocolErrorCode.INVALID_PAYLOAD,
        { details: { issues: parseResult.error.issues } },
      );
    }

    throw new AgentMeshProtocolError(
      `Invalid message field '${path}': ${issue.message}`,
      AgentMeshProtocolErrorCode.INVALID_MESSAGE,
      { details: { issues: parseResult.error.issues } },
    );
  }

  return parseResult.data as AgentMeshMessage;
}

export function isAgentMeshMessage(input: unknown): input is AgentMeshMessage {
  try {
    parseAgentMeshMessage(input);
    return true;
  } catch {
    return false;
  }
}

export interface CreateAgentMeshMessageInput<
  T extends AgentMeshMessageType = AgentMeshMessageType,
> {
  id?: string;
  type: T;
  projectId: string;
  senderId: string;
  recipientId?: string;
  timestamp?: string;
  correlationId?: string;
  causationId?: string;
  taskId?: string;
  executionId?: string;
  payload: Extract<AgentMeshMessage, { type: T }>['payload'];
}

export function createAgentMeshMessage<T extends AgentMeshMessageType>(
  input: CreateAgentMeshMessageInput<T>,
): Extract<AgentMeshMessage, { type: T }> {
  const rawMessage = {
    id: input.id || crypto.randomUUID(),
    protocolVersion: PROTOCOL_VERSION,
    type: input.type,
    projectId: input.projectId,
    senderId: input.senderId,
    ...(input.recipientId !== undefined && { recipientId: input.recipientId }),
    timestamp: input.timestamp || new Date().toISOString(),
    ...(input.correlationId !== undefined && { correlationId: input.correlationId }),
    ...(input.causationId !== undefined && { causationId: input.causationId }),
    ...(input.taskId !== undefined && { taskId: input.taskId }),
    ...(input.executionId !== undefined && { executionId: input.executionId }),
    payload: input.payload,
  };

  return parseAgentMeshMessage(rawMessage) as Extract<AgentMeshMessage, { type: T }>;
}
