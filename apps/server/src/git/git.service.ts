import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {
  GitRepositoryNotFoundError,
  GitRepositoryInvalidError,
  GitWorktreeCreationFailedError,
  GitWorktreeRemovalFailedError,
  GitWorktreeAlreadyExistsError,
} from './git.errors.js';
import { CreateWorktreeParams, GitWorktreeInfo, RemoveWorktreeParams } from './git.types.js';

const execFileAsync = promisify(execFile);

export class GitService {
  private async runGitCommand(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, { shell: false });
      return stdout.trim();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Git command failed [git ${args.join(' ')}]: ${message}`);
    }
  }

  async validateRepository(repositoryPath: string): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(repositoryPath);
    } catch {
      throw new GitRepositoryNotFoundError(`Git repository directory does not exist at '${repositoryPath}'`);
    }

    if (!stat.isDirectory()) {
      throw new GitRepositoryNotFoundError(`Path '${repositoryPath}' is not a directory`);
    }

    try {
      const output = await this.runGitCommand(['-C', repositoryPath, 'rev-parse', '--is-inside-work-tree']);
      if (output !== 'true') {
        throw new GitRepositoryInvalidError(`Directory '${repositoryPath}' is not inside a valid Git work tree`);
      }

      // Check top-level to prevent Git from walking up parent directories
      const topLevel = await this.runGitCommand(['-C', repositoryPath, 'rev-parse', '--show-toplevel']);
      if (path.resolve(topLevel) !== path.resolve(repositoryPath)) {
        throw new GitRepositoryInvalidError(`Directory '${repositoryPath}' is not the root of a Git repository`);
      }
    } catch (error: unknown) {
      if (error instanceof GitRepositoryInvalidError) {
        throw error;
      }
      throw new GitRepositoryInvalidError(`Directory '${repositoryPath}' is not a valid Git repository`);
    }
  }

  async createWorktree(params: CreateWorktreeParams): Promise<void> {
    await this.validateRepository(params.repositoryPath);

    // Ensure parent folder exists
    const parentDir = path.dirname(params.worktreePath);
    await fs.promises.mkdir(parentDir, { recursive: true });

    try {
      await this.runGitCommand([
        '-C',
        params.repositoryPath,
        'worktree',
        'add',
        params.worktreePath,
        '-b',
        params.branchName,
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('already exists')) {
        throw new GitWorktreeAlreadyExistsError(`Worktree or branch already exists for '${params.branchName}'`);
      }
      throw new GitWorktreeCreationFailedError(`Failed to create Git worktree: ${message}`);
    }
  }

  async listWorktrees(repositoryPath: string): Promise<GitWorktreeInfo[]> {
    await this.validateRepository(repositoryPath);

    const output = await this.runGitCommand(['-C', repositoryPath, 'worktree', 'list', '--porcelain']);

    const worktrees: GitWorktreeInfo[] = [];
    const entries = output.split('\n\n');

    for (const entry of entries) {
      if (!entry.trim()) continue;
      const lines = entry.split('\n');
      let worktreePath = '';
      let headCommit = '';
      let branchName: string | undefined;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          worktreePath = line.substring('worktree '.length).trim();
        } else if (line.startsWith('HEAD ')) {
          headCommit = line.substring('HEAD '.length).trim();
        } else if (line.startsWith('branch ')) {
          branchName = line.substring('branch '.length).trim().replace('refs/heads/', '');
        }
      }

      if (worktreePath) {
        worktrees.push({ worktreePath, headCommit, branchName });
      }
    }

    return worktrees;
  }

  async removeWorktree(params: RemoveWorktreeParams): Promise<void> {
    await this.validateRepository(params.repositoryPath);

    try {
      await this.runGitCommand(['-C', params.repositoryPath, 'worktree', 'remove', params.worktreePath]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitWorktreeRemovalFailedError(`Failed to remove Git worktree at '${params.worktreePath}': ${message}`);
    }
  }
}

export const gitService = new GitService();
