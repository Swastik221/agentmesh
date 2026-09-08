export const PROTOCOL_VERSION = '1.0' as const;
export const AGENTMESH_PROTOCOL_VERSION = PROTOCOL_VERSION;

export const AgentMeshMessageType = {
  AGENT_HANDSHAKE: 'agent.handshake',
  AGENT_HANDSHAKE_ACCEPTED: 'agent.handshake.accepted',
  AGENT_HANDSHAKE_REJECTED: 'agent.handshake.rejected',
  AGENT_STATUS: 'agent.status',
  AGENT_MESSAGE: 'agent.message',
  TASK_STATUS: 'task.status',
  TASK_REQUEST: 'task.request',
  TASK_ACCEPTED: 'task.accepted',
  TASK_REJECTED: 'task.rejected',
  TASK_PROGRESS: 'task.progress',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
} as const;

export type AgentMeshMessageType =
  (typeof AgentMeshMessageType)[keyof typeof AgentMeshMessageType];

export const ParticipantType = {
  AGENT: 'agent',
  SERVER: 'server',
  USER: 'user',
  COORDINATOR: 'coordinator',
} as const;

export type ParticipantType = (typeof ParticipantType)[keyof typeof ParticipantType];

export const MessageKind = {
  REQUEST: 'request',
  RESPONSE: 'response',
  EVENT: 'event',
} as const;

export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];
