import { z } from 'zod';
import { AgentMeshMessageType, AGENTMESH_PROTOCOL_VERSION } from './constants.js';

export const agentHandshakePayloadSchema = z
  .object({
    agentId: z.string().trim().min(1, 'Agent ID is required'),
    clientVersion: z.string().trim().optional(),
    capabilities: z
      .array(z.string().trim())
      .optional()
      .transform((caps) => (caps ? caps.map((c) => c.trim().toLowerCase()) : undefined)),
  })
  .strict();

export const agentHandshakeAcceptedPayloadSchema = z.object({
  agentId: z.string().trim().min(1, 'Agent ID is required'),
  sessionId: z.string().trim().min(1, 'Session ID is required'),
  projectId: z.string().trim().min(1, 'Project ID is required'),
  capabilities: z.array(z.string().trim().toLowerCase()),
});

export const agentHandshakeRejectedPayloadSchema = z.object({
  code: z.string().trim().min(1, 'Error code is required'),
  message: z.string().trim().min(1, 'Error message is required'),
  retryable: z.boolean().optional(),
});

export const agentStatusPayloadSchema = z.object({
  status: z.enum(['OFFLINE', 'ONLINE', 'BUSY'], {
    errorMap: () => ({ message: 'Status must be OFFLINE, ONLINE, or BUSY' }),
  }),
});

export const agentMessagePayloadSchema = z.object({
  body: z.string().trim().min(1, 'Message body cannot be empty'),
  metadata: z.record(z.unknown()).optional(),
});

export const taskStatusPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  executionId: z.string().trim().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED'], {
    errorMap: () => ({ message: 'Status must be a valid task status' }),
  }),
  message: z.string().trim().optional(),
});

export const taskRequestPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  executionId: z.string().trim().optional(),
  title: z.string().trim().min(1, 'Task title cannot be empty'),
  description: z.string().trim().min(1, 'Task description cannot be empty'),
  requiredCapabilities: z
    .array(z.string().trim().toLowerCase())
    .optional()
    .transform((caps) => (caps ? Array.from(new Set(caps)) : undefined)),
  metadata: z.record(z.unknown()).optional(),
});

export const taskAcceptedPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  executionId: z.string().trim().optional(),
});

export const taskRejectedPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  executionId: z.string().trim().optional(),
  reason: z.string().trim().min(1, 'Rejection reason cannot be empty'),
});

export const taskProgressPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  executionId: z.string().trim().optional(),
  progress: z.number().min(0, 'Progress must be at least 0').max(100, 'Progress cannot exceed 100'),
  message: z.string().trim().optional(),
});

export const taskCompletedPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  executionId: z.string().trim().optional(),
  result: z.unknown().optional(),
});

export const taskFailedPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  executionId: z.string().trim().optional(),
  error: z.string().trim().min(1, 'Error message cannot be empty'),
  retryable: z.boolean().optional(),
});

export const errorPayloadSchema = z.object({
  code: z.string().trim().min(1, 'Error code cannot be empty'),
  message: z.string().trim().min(1, 'Error message cannot be empty'),
  retryable: z.boolean().optional(),
  details: z.record(z.unknown()).optional(),
});

export const baseEnvelopeSchema = z.object({
  id: z.string().trim().min(1, 'Message ID is required'),
  protocolVersion: z.literal(AGENTMESH_PROTOCOL_VERSION, {
    errorMap: () => ({ message: `Protocol version must be "${AGENTMESH_PROTOCOL_VERSION}"` }),
  }),
  projectId: z.string().trim().min(1, 'Project ID is required'),
  senderId: z.string().trim().min(1, 'Sender ID is required'),
  recipientId: z.string().trim().min(1).optional(),
  timestamp: z.string().datetime({ message: 'Timestamp must be a valid ISO-8601 datetime string' }),
  correlationId: z.string().trim().min(1).optional(),
});

export const agentHandshakeMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.AGENT_HANDSHAKE),
  payload: agentHandshakePayloadSchema,
});

export const agentHandshakeAcceptedMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED),
  payload: agentHandshakeAcceptedPayloadSchema,
});

export const agentHandshakeRejectedMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.AGENT_HANDSHAKE_REJECTED),
  payload: agentHandshakeRejectedPayloadSchema,
});

export const agentStatusMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.AGENT_STATUS),
  payload: agentStatusPayloadSchema,
});

export const agentMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.AGENT_MESSAGE),
  payload: agentMessagePayloadSchema,
});

export const taskStatusMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.TASK_STATUS),
  payload: taskStatusPayloadSchema,
});

export const taskRequestMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.TASK_REQUEST),
  payload: taskRequestPayloadSchema,
});

export const taskAcceptedMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.TASK_ACCEPTED),
  payload: taskAcceptedPayloadSchema,
});

export const taskRejectedMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.TASK_REJECTED),
  payload: taskRejectedPayloadSchema,
});

export const taskProgressMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.TASK_PROGRESS),
  payload: taskProgressPayloadSchema,
});

export const taskCompletedMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.TASK_COMPLETED),
  payload: taskCompletedPayloadSchema,
});

export const taskFailedMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.TASK_FAILED),
  payload: taskFailedPayloadSchema,
});

export const errorMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.ERROR),
  payload: errorPayloadSchema,
});

export const agentMeshMessageSchema = z.discriminatedUnion('type', [
  agentHandshakeMessageSchema,
  agentHandshakeAcceptedMessageSchema,
  agentHandshakeRejectedMessageSchema,
  agentStatusMessageSchema,
  agentMessageSchema,
  taskStatusMessageSchema,
  taskRequestMessageSchema,
  taskAcceptedMessageSchema,
  taskRejectedMessageSchema,
  taskProgressMessageSchema,
  taskCompletedMessageSchema,
  taskFailedMessageSchema,
  errorMessageSchema,
]);

