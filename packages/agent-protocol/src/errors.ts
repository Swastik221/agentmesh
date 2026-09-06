export enum AgentMeshProtocolErrorCode {
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  INVALID_VERSION = 'INVALID_VERSION',
  UNKNOWN_MESSAGE_TYPE = 'UNKNOWN_MESSAGE_TYPE',
  INVALID_PAYLOAD = 'INVALID_PAYLOAD',
}

export class AgentMeshProtocolError extends Error {
  public readonly code: AgentMeshProtocolErrorCode;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: AgentMeshProtocolErrorCode = AgentMeshProtocolErrorCode.INVALID_MESSAGE,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AgentMeshProtocolError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
