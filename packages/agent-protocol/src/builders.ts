import crypto from 'node:crypto';
import { AgentMeshMessageType, PROTOCOL_VERSION, MessageKind } from './constants.js';
import {
  AgentHandshakeMessage,
  AgentHandshakeAcceptedMessage,
  AgentHandshakeRejectedMessage,
  AgentStatusMessage,
  AgentMessage,
  TaskRequestMessage,
  TaskAcceptedMessage,
  TaskRejectedMessage,
  TaskProgressMessage,
  TaskCompletedMessage,
  TaskFailedMessage,
  TaskStatusMessage,
  ErrorMessage,
  PingMessage,
  PongMessage,
  AgentHandshakePayload,
  AgentHandshakeAcceptedPayload,
  AgentHandshakeRejectedPayload,
  AgentStatusPayload,
  AgentMessagePayload,
  TaskRequestPayload,
  TaskAcceptedPayload,
  TaskRejectedPayload,
  TaskProgressPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
  TaskStatusPayload,
  ErrorPayload,
} from './types.js';

export interface BaseBuilderOptions {
  id?: string;
  projectId: string;
  senderId: string;
  recipientId?: string;
  correlationId?: string;
  causationId?: string;
  taskId?: string;
  executionId?: string;
  timestamp?: string;
}

function buildEnvelope(options: BaseBuilderOptions, kind?: MessageKind) {
  return {
    id: options.id || crypto.randomUUID(),
    protocolVersion: PROTOCOL_VERSION,
    projectId: options.projectId,
    senderId: options.senderId,
    ...(options.recipientId !== undefined && { recipientId: options.recipientId }),
    timestamp: options.timestamp || new Date().toISOString(),
    ...(options.correlationId !== undefined && { correlationId: options.correlationId }),
    ...(options.causationId !== undefined && { causationId: options.causationId }),
    ...(options.taskId !== undefined && { taskId: options.taskId }),
    ...(options.executionId !== undefined && { executionId: options.executionId }),
    ...(kind && { kind }),
  };
}

export function createAgentHandshake(
  options: BaseBuilderOptions,
  payload: AgentHandshakePayload,
): AgentHandshakeMessage {
  return {
    ...buildEnvelope(options, MessageKind.REQUEST),
    type: AgentMeshMessageType.AGENT_HANDSHAKE,
    payload,
  };
}

export function createAgentHandshakeAccepted(
  options: BaseBuilderOptions,
  payload: AgentHandshakeAcceptedPayload,
): AgentHandshakeAcceptedMessage {
  return {
    ...buildEnvelope(options, MessageKind.RESPONSE),
    type: AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED,
    payload,
  };
}

export function createAgentHandshakeRejected(
  options: BaseBuilderOptions,
  payload: AgentHandshakeRejectedPayload,
): AgentHandshakeRejectedMessage {
  return {
    ...buildEnvelope(options, MessageKind.RESPONSE),
    type: AgentMeshMessageType.AGENT_HANDSHAKE_REJECTED,
    payload,
  };
}

export function createAgentStatusMessage(
  options: BaseBuilderOptions,
  payload: AgentStatusPayload,
): AgentStatusMessage {
  return {
    ...buildEnvelope(options, MessageKind.EVENT),
    type: AgentMeshMessageType.AGENT_STATUS,
    payload,
  };
}

export function createAgentMessage(
  options: BaseBuilderOptions,
  payload: AgentMessagePayload,
): AgentMessage {
  return {
    ...buildEnvelope(options, MessageKind.EVENT),
    type: AgentMeshMessageType.AGENT_MESSAGE,
    payload,
  };
}

export function createTaskRequestMessage(
  options: BaseBuilderOptions,
  payload: TaskRequestPayload,
): TaskRequestMessage {
  return {
    ...buildEnvelope(
      {
        ...options,
        taskId: options.taskId || payload.taskId,
        executionId: options.executionId || payload.executionId,
      },
      MessageKind.REQUEST,
    ),
    type: AgentMeshMessageType.TASK_REQUEST,
    payload,
  };
}

export function createTaskAcceptedMessage(
  options: BaseBuilderOptions,
  payload: TaskAcceptedPayload,
): TaskAcceptedMessage {
  return {
    ...buildEnvelope(
      {
        ...options,
        taskId: options.taskId || payload.taskId,
        executionId: options.executionId || payload.executionId,
      },
      MessageKind.RESPONSE,
    ),
    type: AgentMeshMessageType.TASK_ACCEPTED,
    payload,
  };
}

export function createTaskRejectedMessage(
  options: BaseBuilderOptions,
  payload: TaskRejectedPayload,
): TaskRejectedMessage {
  return {
    ...buildEnvelope(
      {
        ...options,
        taskId: options.taskId || payload.taskId,
        executionId: options.executionId || payload.executionId,
      },
      MessageKind.RESPONSE,
    ),
    type: AgentMeshMessageType.TASK_REJECTED,
    payload,
  };
}

export function createTaskProgressMessage(
  options: BaseBuilderOptions,
  payload: TaskProgressPayload,
): TaskProgressMessage {
  return {
    ...buildEnvelope(
      {
        ...options,
        taskId: options.taskId || payload.taskId,
        executionId: options.executionId || payload.executionId,
      },
      MessageKind.EVENT,
    ),
    type: AgentMeshMessageType.TASK_PROGRESS,
    payload,
  };
}

export function createTaskCompletedMessage(
  options: BaseBuilderOptions,
  payload: TaskCompletedPayload,
): TaskCompletedMessage {
  return {
    ...buildEnvelope(
      {
        ...options,
        taskId: options.taskId || payload.taskId,
        executionId: options.executionId || payload.executionId,
      },
      MessageKind.EVENT,
    ),
    type: AgentMeshMessageType.TASK_COMPLETED,
    payload,
  };
}

export function createTaskFailedMessage(
  options: BaseBuilderOptions,
  payload: TaskFailedPayload,
): TaskFailedMessage {
  return {
    ...buildEnvelope(
      {
        ...options,
        taskId: options.taskId || payload.taskId,
        executionId: options.executionId || payload.executionId,
      },
      MessageKind.EVENT,
    ),
    type: AgentMeshMessageType.TASK_FAILED,
    payload,
  };
}

export function createTaskStatusMessage(
  options: BaseBuilderOptions,
  payload: TaskStatusPayload,
): TaskStatusMessage {
  return {
    ...buildEnvelope(
      {
        ...options,
        taskId: options.taskId || payload.taskId,
        executionId: options.executionId || payload.executionId,
      },
      MessageKind.EVENT,
    ),
    type: AgentMeshMessageType.TASK_STATUS,
    payload,
  };
}

export function createErrorMessage(
  options: BaseBuilderOptions,
  payload: ErrorPayload,
): ErrorMessage {
  return {
    ...buildEnvelope(options, MessageKind.EVENT),
    type: AgentMeshMessageType.ERROR,
    payload,
  };
}

export function createPingMessage(options: BaseBuilderOptions): PingMessage {
  return {
    ...buildEnvelope(options, MessageKind.REQUEST),
    type: AgentMeshMessageType.PING,
    payload: {},
  };
}

export function createPongMessage(options: BaseBuilderOptions): PongMessage {
  return {
    ...buildEnvelope(options, MessageKind.RESPONSE),
    type: AgentMeshMessageType.PONG,
    payload: {},
  };
}
