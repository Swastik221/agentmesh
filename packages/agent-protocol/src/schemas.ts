import { z } from 'zod';
import { AgentMeshMessageType, PROTOCOL_VERSION } from './constants.js';

export const participantSchema = z.object({
  type: z.enum(['agent', 'server', 'user', 'coordinator']),
  id: z.string().trim().min(1, 'Participant ID is required'),
});

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

export const pingPayloadSchema = z.object({}).optional();
export const pongPayloadSchema = z.object({}).optional();

export const workspaceMemberSchema = z.object({
  userId: z.string().trim().min(1),
  displayName: z.string().nullable().optional(),
  walletAddress: z.string().nullable().optional(),
  role: z.string(),
  status: z.enum(['ONLINE', 'OFFLINE']),
});

export const workspaceAgentSchema = z.object({
  agentId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  ownerId: z.string().trim().min(1),
  provider: z.string(),
  status: z.enum(['ONLINE', 'OFFLINE', 'BUSY']),
});

export const workspaceTaskSummarySchema = z.object({
  taskId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  status: z.string(),
  priority: z.string(),
});

export const workspaceSnapshotPayloadSchema = z.object({
  workspace: z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
  }),
  members: z.array(workspaceMemberSchema),
  agents: z.array(workspaceAgentSchema),
  tasks: z.array(workspaceTaskSummarySchema),
});

export const workspacePresenceChangedPayloadSchema = z.object({
  entityType: z.enum(['user', 'agent']),
  entityId: z.string().trim().min(1),
  status: z.enum(['ONLINE', 'OFFLINE', 'BUSY']),
  metadata: z.record(z.unknown()).optional(),
});

export const taskAssignedPayloadSchema = z.object({
  taskId: z.string().trim().min(1, 'Task ID is required'),
  agentId: z.string().trim().min(1, 'Agent ID is required'),
  assignmentSource: z.enum(['HUMAN_PREFERENCE', 'CAPABILITY_MATCH']),
  score: z.number().optional(),
  explanation: z.record(z.unknown()).optional(),
});

export const artifactCreatedPayloadSchema = z.object({
  artifactId: z.string().trim().min(1, 'Artifact ID is required'),
  projectId: z.string().trim().min(1, 'Project ID is required'),
  taskId: z.string().trim().min(1, 'Task ID is required'),
  executionId: z.string().trim().optional(),
  agentId: z.string().trim().min(1, 'Agent ID is required'),
  type: z.string().trim().min(1, 'Artifact type is required'),
  name: z.string().trim().min(1, 'Artifact name is required'),
  version: z.number().int().positive('Version must be a positive integer'),
});

export const artifactAvailablePayloadSchema = z.object({
  artifactId: z.string().trim().min(1, 'Artifact ID is required'),
  projectId: z.string().trim().min(1, 'Project ID is required'),
  taskId: z.string().trim().min(1, 'Task ID is required'),
  consumerTaskId: z.string().trim().optional(),
});

export const dependencyDeclaredPayloadSchema = z.object({
  dependencyId: z.string().trim().min(1, 'Dependency ID is required'),
  projectId: z.string().trim().min(1, 'Project ID is required'),
  taskId: z.string().trim().min(1, 'Task ID is required'),
  dependencyType: z.string().trim().min(1, 'Dependency type is required'),
  dependsOnTaskId: z.string().trim().optional(),
  artifactId: z.string().trim().optional(),
});

export const dependencyAvailablePayloadSchema = z.object({
  dependencyId: z.string().trim().min(1, 'Dependency ID is required'),
  projectId: z.string().trim().min(1, 'Project ID is required'),
  taskId: z.string().trim().min(1, 'Task ID is required'),
  dependsOnTaskId: z.string().trim().optional(),
  artifactId: z.string().trim().optional(),
  available: z.boolean(),
});

export const baseEnvelopeSchema = z.object({
  id: z.string().trim().min(1, 'Message ID is required'),
  protocolVersion: z.literal(PROTOCOL_VERSION, {
    errorMap: () => ({ message: `Protocol version must be "${PROTOCOL_VERSION}"` }),
  }),
  projectId: z.string().trim().min(1, 'Project ID is required'),
  senderId: z.string().trim().min(1, 'Sender ID is required'),
  recipientId: z.string().trim().min(1).optional(),
  sender: participantSchema.optional(),
  recipient: participantSchema.optional(),
  timestamp: z.string().datetime({ message: 'Timestamp must be a valid ISO-8601 datetime string' }),
  correlationId: z.string().trim().min(1).optional(),
  causationId: z.string().trim().min(1).optional(),
  taskId: z.string().trim().min(1).optional(),
  executionId: z.string().trim().min(1).optional(),
  kind: z.enum(['request', 'response', 'event']).optional(),
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

export const pingMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.PING),
  payload: pingPayloadSchema.default({}),
});

export const pongMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.PONG),
  payload: pongPayloadSchema.default({}),
});

export const workspaceSnapshotMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.WORKSPACE_SNAPSHOT),
  payload: workspaceSnapshotPayloadSchema,
});

export const workspacePresenceChangedMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED),
  payload: workspacePresenceChangedPayloadSchema,
});

export const taskAssignedMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.TASK_ASSIGNED),
  payload: taskAssignedPayloadSchema,
});

export const artifactCreatedMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.ARTIFACT_CREATED),
  payload: artifactCreatedPayloadSchema,
});

export const artifactAvailableMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.ARTIFACT_AVAILABLE),
  payload: artifactAvailablePayloadSchema,
});

export const dependencyDeclaredMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.DEPENDENCY_DECLARED),
  payload: dependencyDeclaredPayloadSchema,
});

export const dependencyAvailableMessageSchema = baseEnvelopeSchema.extend({
  type: z.literal(AgentMeshMessageType.DEPENDENCY_AVAILABLE),
  payload: dependencyAvailablePayloadSchema,
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
  pingMessageSchema,
  pongMessageSchema,
  workspaceSnapshotMessageSchema,
  workspacePresenceChangedMessageSchema,
  taskAssignedMessageSchema,
  artifactCreatedMessageSchema,
  artifactAvailableMessageSchema,
  dependencyDeclaredMessageSchema,
  dependencyAvailableMessageSchema,
]);
