export interface GitWorktreeInfo {
  worktreePath: string;
  headCommit: string;
  branchName?: string;
}

export interface CreateWorktreeParams {
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
}

export interface RemoveWorktreeParams {
  repositoryPath: string;
  worktreePath: string;
}
