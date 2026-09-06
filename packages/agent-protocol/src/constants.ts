export const AGENTMESH_PROTOCOL_VERSION = '0.1' as const;

export const AgentMeshMessageType = {
  AGENT_STATUS: 'agent.status',
  AGENT_MESSAGE: 'agent.message',
  TASK_REQUEST: 'task.request',
  TASK_ACCEPTED: 'task.accepted',
  TASK_REJECTED: 'task.rejected',
  TASK_PROGRESS: 'task.progress',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  ERROR: 'error',
} as const;

export type AgentMeshMessageType = (typeof AgentMeshMessageType)[keyof typeof AgentMeshMessageType];
