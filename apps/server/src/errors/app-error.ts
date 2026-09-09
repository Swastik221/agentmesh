export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_SERVER_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad Request') {
    super(message, 400, 'BAD_REQUEST');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource Not Found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class FileConflictError extends AppError {
  public readonly conflicts: Array<{ taskId: string; filePaths: string[] }>;

  constructor(
    conflicts: Array<{ taskId: string; filePaths: string[] }>,
    message: string = 'Task conflicts with an active task modifying the same workspace files.',
  ) {
    super(message, 409, 'FILE_CONFLICT');
    this.conflicts = conflicts;
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ApprovalRequiredError extends AppError {
  public readonly approvalRequestId: string;
  public readonly approvalRequest: unknown;

  constructor(
    approvalRequestId: string,
    approvalRequest: unknown,
    message: string = 'Action requires human approval',
  ) {
    super(message, 202, 'APPROVAL_REQUIRED');
    this.approvalRequestId = approvalRequestId;
    this.approvalRequest = approvalRequest;
  }
}

