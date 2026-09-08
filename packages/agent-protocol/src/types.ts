import { z } from 'zod';
import {
  participantSchema,
  agentHandshakePayloadSchema,
  agentHandshakeAcceptedPayloadSchema,
  agentHandshakeRejectedPayloadSchema,
  agentStatusPayloadSchema,
  agentMessagePayloadSchema,
  taskStatusPayloadSchema,
  taskRequestPayloadSchema,
  taskAcceptedPayloadSchema,
  taskRejectedPayloadSchema,
  taskProgressPayloadSchema,
  taskCompletedPayloadSchema,
  taskFailedPayloadSchema,
  errorPayloadSchema,
  pingPayloadSchema,
  pongPayloadSchema,
  workspaceSnapshotPayloadSchema,
  workspacePresenceChangedPayloadSchema,
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
  taskAssignedPayloadSchema,
  taskAssignedMessageSchema,
  artifactCreatedPayloadSchema,
  artifactCreatedMessageSchema,
  artifactAvailablePayloadSchema,
  artifactAvailableMessageSchema,
  dependencyDeclaredPayloadSchema,
  dependencyDeclaredMessageSchema,
  dependencyAvailablePayloadSchema,
  dependencyAvailableMessageSchema,
  workspaceDeltaChangeSchema,
  workspaceDeltaPayloadSchema,
  workspaceDeltaMessageSchema,
  workspaceResyncRequestPayloadSchema,
  workspaceResyncRequestMessageSchema,
  workspaceResyncRequiredPayloadSchema,
  workspaceResyncRequiredMessageSchema,
  agentMeshMessageSchema,
} from './schemas.js';
import { PROTOCOL_VERSION, ParticipantType, MessageKind } from './constants.js';

export type MessageParticipant = z.infer<typeof participantSchema>;

export type AgentHandshakePayload = z.infer<typeof agentHandshakePayloadSchema>;
export type AgentHandshakeAcceptedPayload = z.infer<typeof agentHandshakeAcceptedPayloadSchema>;
export type AgentHandshakeRejectedPayload = z.infer<typeof agentHandshakeRejectedPayloadSchema>;
export type AgentStatusPayload = z.infer<typeof agentStatusPayloadSchema>;
export type AgentMessagePayload = z.infer<typeof agentMessagePayloadSchema>;
export type TaskStatusPayload = z.infer<typeof taskStatusPayloadSchema>;
export type TaskRequestPayload = z.infer<typeof taskRequestPayloadSchema>;
export type TaskAcceptedPayload = z.infer<typeof taskAcceptedPayloadSchema>;
export type TaskRejectedPayload = z.infer<typeof taskRejectedPayloadSchema>;
export type TaskProgressPayload = z.infer<typeof taskProgressPayloadSchema>;
export type TaskCompletedPayload = z.infer<typeof taskCompletedPayloadSchema>;
export type TaskFailedPayload = z.infer<typeof taskFailedPayloadSchema>;
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;
export type PingPayload = z.infer<typeof pingPayloadSchema>;
export type PongPayload = z.infer<typeof pongPayloadSchema>;
export type WorkspaceSnapshotPayload = z.infer<typeof workspaceSnapshotPayloadSchema>;
export type WorkspacePresenceChangedPayload = z.infer<typeof workspacePresenceChangedPayloadSchema>;
export type TaskAssignedPayload = z.infer<typeof taskAssignedPayloadSchema>;
export type ArtifactCreatedPayload = z.infer<typeof artifactCreatedPayloadSchema>;
export type ArtifactAvailablePayload = z.infer<typeof artifactAvailablePayloadSchema>;
export type DependencyDeclaredPayload = z.infer<typeof dependencyDeclaredPayloadSchema>;
export type DependencyAvailablePayload = z.infer<typeof dependencyAvailablePayloadSchema>;

export type WorkspaceDeltaChange = z.infer<typeof workspaceDeltaChangeSchema>;
export type WorkspaceDeltaPayload = z.infer<typeof workspaceDeltaPayloadSchema>;
export type WorkspaceResyncRequestPayload = z.infer<typeof workspaceResyncRequestPayloadSchema>;
export type WorkspaceResyncRequiredPayload = z.infer<typeof workspaceResyncRequiredPayloadSchema>;

export type AgentHandshakeMessage = z.infer<typeof agentHandshakeMessageSchema>;
export type AgentHandshakeAcceptedMessage = z.infer<typeof agentHandshakeAcceptedMessageSchema>;
export type AgentHandshakeRejectedMessage = z.infer<typeof agentHandshakeRejectedMessageSchema>;
export type AgentStatusMessage = z.infer<typeof agentStatusMessageSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type TaskStatusMessage = z.infer<typeof taskStatusMessageSchema>;
export type TaskRequestMessage = z.infer<typeof taskRequestMessageSchema>;
export type TaskAcceptedMessage = z.infer<typeof taskAcceptedMessageSchema>;
export type TaskRejectedMessage = z.infer<typeof taskRejectedMessageSchema>;
export type TaskProgressMessage = z.infer<typeof taskProgressMessageSchema>;
export type TaskCompletedMessage = z.infer<typeof taskCompletedMessageSchema>;
export type TaskFailedMessage = z.infer<typeof taskFailedMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type PongMessage = z.infer<typeof pongMessageSchema>;
export type WorkspaceSnapshotMessage = z.infer<typeof workspaceSnapshotMessageSchema>;
export type WorkspacePresenceChangedMessage = z.infer<typeof workspacePresenceChangedMessageSchema>;
export type TaskAssignedMessage = z.infer<typeof taskAssignedMessageSchema>;
export type ArtifactCreatedMessage = z.infer<typeof artifactCreatedMessageSchema>;
export type ArtifactAvailableMessage = z.infer<typeof artifactAvailableMessageSchema>;
export type DependencyDeclaredMessage = z.infer<typeof dependencyDeclaredMessageSchema>;
export type DependencyAvailableMessage = z.infer<typeof dependencyAvailableMessageSchema>;
export type WorkspaceDeltaMessage = z.infer<typeof workspaceDeltaMessageSchema>;
export type WorkspaceResyncRequestMessage = z.infer<typeof workspaceResyncRequestMessageSchema>;
export type WorkspaceResyncRequiredMessage = z.infer<typeof workspaceResyncRequiredMessageSchema>;

export type AgentMeshMessage = z.infer<typeof agentMeshMessageSchema>;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
export { ParticipantType, MessageKind };
