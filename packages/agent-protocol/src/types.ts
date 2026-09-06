import { z } from 'zod';
import {
  agentStatusPayloadSchema,
  agentMessagePayloadSchema,
  taskRequestPayloadSchema,
  taskAcceptedPayloadSchema,
  taskRejectedPayloadSchema,
  taskProgressPayloadSchema,
  taskCompletedPayloadSchema,
  taskFailedPayloadSchema,
  errorPayloadSchema,
  agentStatusMessageSchema,
  agentMessageSchema,
  taskRequestMessageSchema,
  taskAcceptedMessageSchema,
  taskRejectedMessageSchema,
  taskProgressMessageSchema,
  taskCompletedMessageSchema,
  taskFailedMessageSchema,
  errorMessageSchema,
  agentMeshMessageSchema,
} from './schemas.js';
import { AGENTMESH_PROTOCOL_VERSION } from './constants.js';

export type AgentStatusPayload = z.infer<typeof agentStatusPayloadSchema>;
export type AgentMessagePayload = z.infer<typeof agentMessagePayloadSchema>;
export type TaskRequestPayload = z.infer<typeof taskRequestPayloadSchema>;
export type TaskAcceptedPayload = z.infer<typeof taskAcceptedPayloadSchema>;
export type TaskRejectedPayload = z.infer<typeof taskRejectedPayloadSchema>;
export type TaskProgressPayload = z.infer<typeof taskProgressPayloadSchema>;
export type TaskCompletedPayload = z.infer<typeof taskCompletedPayloadSchema>;
export type TaskFailedPayload = z.infer<typeof taskFailedPayloadSchema>;
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;

export type AgentStatusMessage = z.infer<typeof agentStatusMessageSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type TaskRequestMessage = z.infer<typeof taskRequestMessageSchema>;
export type TaskAcceptedMessage = z.infer<typeof taskAcceptedMessageSchema>;
export type TaskRejectedMessage = z.infer<typeof taskRejectedMessageSchema>;
export type TaskProgressMessage = z.infer<typeof taskProgressMessageSchema>;
export type TaskCompletedMessage = z.infer<typeof taskCompletedMessageSchema>;
export type TaskFailedMessage = z.infer<typeof taskFailedMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;

export type AgentMeshMessage = z.infer<typeof agentMeshMessageSchema>;

export type ProtocolVersion = typeof AGENTMESH_PROTOCOL_VERSION;
