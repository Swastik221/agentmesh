import { AgentMeshMessageType } from './constants.js';

export function isTerminalTaskMessageType(type: AgentMeshMessageType): boolean {
  return (
    type === AgentMeshMessageType.TASK_COMPLETED ||
    type === AgentMeshMessageType.TASK_FAILED ||
    type === AgentMeshMessageType.TASK_REJECTED
  );
}

export function isValidTaskMessageTransition(
  currentType: AgentMeshMessageType | null,
  nextType: AgentMeshMessageType,
): boolean {
  if (!currentType) {
    return nextType === AgentMeshMessageType.TASK_REQUEST || nextType === AgentMeshMessageType.AGENT_HANDSHAKE;
  }

  if (isTerminalTaskMessageType(currentType)) {
    return false;
  }

  switch (currentType) {
    case AgentMeshMessageType.TASK_REQUEST:
      return (
        nextType === AgentMeshMessageType.TASK_ACCEPTED ||
        nextType === AgentMeshMessageType.TASK_REJECTED ||
        nextType === AgentMeshMessageType.TASK_FAILED
      );

    case AgentMeshMessageType.TASK_ACCEPTED:
    case AgentMeshMessageType.TASK_PROGRESS:
      return (
        nextType === AgentMeshMessageType.TASK_PROGRESS ||
        nextType === AgentMeshMessageType.TASK_COMPLETED ||
        nextType === AgentMeshMessageType.TASK_FAILED ||
        nextType === AgentMeshMessageType.TASK_STATUS
      );

    default:
      return true;
  }
}
