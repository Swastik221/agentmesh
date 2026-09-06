import { z } from 'zod';
import { AgentMeshMessageType, AGENTMESH_PROTOCOL_VERSION } from './constants.js';

export const agentStatusPayloadSchema = z.object({
  status: z.enum(['OFFLINE', 'ONLINE', 'BUSY'], {
    errorMap: () => ({ message: 'Status must be OFFLINE, ONLINE, or BUSY' }),
  }),
});

export const agentMessagePayloadSchema = z.object({
  body: z.string().trim().min(1, 'Message body cannot be empty'),
  metadata: z.record(z.unknown()).optional(),
});

export const taskRequestPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
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
});

export const taskRejectedPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  reason: z.string().trim().min(1, 'Rejection reason cannot be empty'),
});

export const taskProgressPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  progress: z.number().min(0, 'Progress must be at least 0').max(100, 'Progress cannot exceed 100'),
  message: z.string().trim().optional(),
});

export const taskCompletedPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  result: z.unknown().optional(),
});

export const taskFailedPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
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

export const agentStatusMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.AGENT_STATUS),
  payload: agentStatusPayloadSchema,
});

export const agentMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.AGENT_MESSAGE),
  payload: agentMessagePayloadSchema,
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
  agentStatusMessageSchema,
  agentMessageSchema,
  taskRequestMessageSchema,
  taskAcceptedMessageSchema,
  taskRejectedMessageSchema,
  taskProgressMessageSchema,
  taskCompletedMessageSchema,
  taskFailedMessageSchema,
  errorMessageSchema,
]);
