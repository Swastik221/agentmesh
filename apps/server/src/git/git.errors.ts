import { AppError } from '../errors/app-error.js';

export class GitRepositoryNotFoundError extends AppError {
  constructor(message: string = 'Git repository not found') {
    super(message, 404, 'GIT_REPOSITORY_NOT_FOUND');
  }
}

export class GitRepositoryInvalidError extends AppError {
  constructor(message: string = 'Directory is not a valid Git repository') {
    super(message, 400, 'GIT_REPOSITORY_INVALID');
  }
}

export class GitWorktreeAlreadyExistsError extends AppError {
  constructor(message: string = 'Worktree already exists for this execution') {
    super(message, 409, 'GIT_WORKTREE_ALREADY_EXISTS');
  }
}

export class GitWorktreeNotFoundError extends AppError {
  constructor(message: string = 'Worktree not found') {
    super(message, 404, 'GIT_WORKTREE_NOT_FOUND');
  }
}

export class GitWorktreePathInvalidError extends AppError {
  constructor(message: string = 'Worktree path is invalid or outside allowed workspace boundary') {
    super(message, 400, 'GIT_WORKTREE_PATH_INVALID');
  }
}

export class GitWorktreeCreationFailedError extends AppError {
  constructor(message: string = 'Failed to create Git worktree') {
    super(message, 500, 'GIT_WORKTREE_CREATION_FAILED');
  }
}

export class GitWorktreeRemovalFailedError extends AppError {
  constructor(message: string = 'Failed to remove Git worktree') {
    super(message, 500, 'GIT_WORKTREE_REMOVAL_FAILED');
  }
}
