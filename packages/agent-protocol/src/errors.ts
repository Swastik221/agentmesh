export enum AgentMeshProtocolErrorCode {
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  INVALID_VERSION = 'INVALID_VERSION',
  UNSUPPORTED_PROTOCOL_VERSION = 'UNSUPPORTED_PROTOCOL_VERSION',
  UNKNOWN_MESSAGE_TYPE = 'UNKNOWN_MESSAGE_TYPE',
  INVALID_PAYLOAD = 'INVALID_PAYLOAD',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_STATE = 'INVALID_STATE',
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  TASK_NOT_ASSIGNED = 'TASK_NOT_ASSIGNED',
  EXECUTION_NOT_FOUND = 'EXECUTION_NOT_FOUND',
  DUPLICATE_MESSAGE = 'DUPLICATE_MESSAGE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ProtocolErrorDetails {
  code: string;
  message: string;
  retryable?: boolean;
  correlationId?: string;
  details?: Record<string, unknown>;
}

export class AgentMeshProtocolError extends Error {
  public readonly code: AgentMeshProtocolErrorCode | string;
  public readonly retryable: boolean;
  public readonly correlationId?: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: AgentMeshProtocolErrorCode | string = AgentMeshProtocolErrorCode.INVALID_MESSAGE,
    options?: { retryable?: boolean; correlationId?: string; details?: unknown },
  ) {
    super(message);
    this.name = 'AgentMeshProtocolError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.correlationId = options?.correlationId;
    this.details = options?.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): ProtocolErrorDetails {
    const res: ProtocolErrorDetails = {
      code: String(this.code),
      message: this.message,
      retryable: this.retryable,
    };
    if (this.correlationId) {
      res.correlationId = this.correlationId;
    }
    if (this.details && typeof this.details === 'object' && !Array.isArray(this.details)) {
      res.details = this.details as Record<string, unknown>;
    }
    return res;
  }
}
