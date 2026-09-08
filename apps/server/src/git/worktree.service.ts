import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../errors/app-error.js';
import {
  GitRepositoryNotFoundError,
  GitWorktreeAlreadyExistsError,
  GitWorktreeNotFoundError,
  GitWorktreePathInvalidError,
} from './git.errors.js';
import { gitService } from './git.service.js';
import { ListWorktreesQueryDTO } from '@agentmesh/shared';

export class WorktreeService {
  public async verifyProjectMembership(projectId: string, userId: string): Promise<void> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('User is not a member of this project');
    }
  }

  public assertPathContained(parentPath: string, childPath: string): void {
    const resolvedParent = path.resolve(parentPath);
    const resolvedChild = path.resolve(childPath);

    if (
      resolvedChild !== resolvedParent &&
      !resolvedChild.startsWith(resolvedParent + path.sep)
    ) {
      throw new GitWorktreePathInvalidError(
        `Path '${childPath}' is outside allowed workspace boundary '${parentPath}'`,
      );
    }

    let realParent = resolvedParent;
    let targetParent = resolvedParent;
    while (!fs.existsSync(targetParent) && targetParent !== path.parse(targetParent).root) {
      targetParent = path.dirname(targetParent);
    }
    if (fs.existsSync(targetParent)) {
      const realTarget = fs.realpathSync(targetParent);
      const relativeSuffix = path.relative(targetParent, resolvedParent);
      realParent = relativeSuffix ? path.resolve(realTarget, relativeSuffix) : realTarget;
    }

    let realChild = resolvedChild;
    let targetChild = resolvedChild;
    while (!fs.existsSync(targetChild) && targetChild !== path.parse(targetChild).root) {
      targetChild = path.dirname(targetChild);
    }
    if (fs.existsSync(targetChild)) {
      const realTarget = fs.realpathSync(targetChild);
      const relativeSuffix = path.relative(targetChild, resolvedChild);
      realChild = relativeSuffix ? path.resolve(realTarget, relativeSuffix) : realTarget;
    }

    if (
      realChild !== realParent &&
      !realChild.startsWith(realParent + path.sep)
    ) {
      throw new GitWorktreePathInvalidError(
        `Path '${childPath}' resolves via symlink outside allowed workspace boundary '${parentPath}'`,
      );
    }
  }

  async createWorktree(projectId: string, executionId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const execution = await prisma.taskExecution.findUnique({
      where: { id: executionId },
      include: {
        task: true,
        agent: true,
      },
    });

    if (!execution || execution.task.projectId !== projectId) {
      throw new NotFoundError('Execution not found in this project');
    }

    if (execution.agent.projectId !== projectId) {
      throw new ForbiddenError('Agent does not belong to this project');
    }

    const responsibility = await prisma.taskResponsibility.findUnique({
      where: {
        taskId_agentId: {
          taskId: execution.taskId,
          agentId: execution.agentId,
        },
      },
    });

    if (!responsibility) {
      throw new ForbiddenError('Agent is not responsible for this task');
    }

    const workspace = await prisma.projectWorkspace.findUnique({
      where: { projectId },
    });

    if (!workspace) {
      throw new NotFoundError('Project workspace not found');
    }

    if (!workspace.gitRepoPath) {
      throw new GitRepositoryNotFoundError('Workspace Git repository path is not configured');
    }

    // Check repository path security boundary
    this.assertPathContained(workspace.rootPath, workspace.gitRepoPath);

    // Validate git repository
    await gitService.validateRepository(workspace.gitRepoPath);

    // Check existing worktree for execution
    const existingWorktree = await prisma.gitWorktree.findUnique({
      where: { executionId },
    });

    if (existingWorktree && existingWorktree.status === 'ACTIVE') {
      throw new GitWorktreeAlreadyExistsError();
    }

    // Generate server-controlled worktree path and branch name
    const worktreePath = path.resolve(workspace.rootPath, '.worktrees', executionId);
    const branchName = `agentmesh/execution/${executionId}`;

    // Validate worktree path security boundary
    this.assertPathContained(workspace.rootPath, worktreePath);

    // Create physical Git worktree
    await gitService.createWorktree({
      repositoryPath: workspace.gitRepoPath,
      worktreePath,
      branchName,
    });

    // Record in database
    try {
      return await prisma.gitWorktree.create({
        data: {
          workspaceId: workspace.id,
          executionId,
          agentId: execution.agentId,
          taskId: execution.taskId,
          path: worktreePath,
          branchName,
          status: 'ACTIVE',
        },
      });
    } catch (err: unknown) {
      // Compensating physical worktree cleanup
      try {
        await gitService.removeWorktree({
          repositoryPath: workspace.gitRepoPath,
          worktreePath,
        });
      } catch (cleanupErr: unknown) {
        console.error(`Failed to clean up physical worktree at '${worktreePath}' after database failure:`, cleanupErr);
      }

      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new GitWorktreeAlreadyExistsError();
      }
      throw err;
    }
  }

  async getWorktree(projectId: string, executionId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const worktree = await prisma.gitWorktree.findUnique({
      where: { executionId },
      include: {
        workspace: true,
      },
    });

    if (!worktree || worktree.workspace.projectId !== projectId) {
      throw new GitWorktreeNotFoundError('Git worktree not found for execution');
    }

    return worktree;
  }

  async listWorktrees(projectId: string, userId: string, query: ListWorktreesQueryDTO) {
    await this.verifyProjectMembership(projectId, userId);

    const workspace = await prisma.projectWorkspace.findUnique({
      where: { projectId },
    });

    if (!workspace) {
      throw new NotFoundError('Project workspace not found');
    }

    const where: Prisma.GitWorktreeWhereInput = {
      workspaceId: workspace.id,
    };

    if (query.agentId) where.agentId = query.agentId;
    if (query.taskId) where.taskId = query.taskId;
    if (query.executionId) where.executionId = query.executionId;
    if (query.status) where.status = query.status;

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [items, total] = await prisma.$transaction([
      prisma.gitWorktree.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.gitWorktree.count({ where }),
    ]);

    return {
      items,
      page,
      limit,
      total,
    };
  }

  async removeWorktree(projectId: string, worktreeId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const worktree = await prisma.gitWorktree.findUnique({
      where: { id: worktreeId },
      include: {
        workspace: true,
      },
    });

    if (!worktree || worktree.workspace.projectId !== projectId) {
      throw new GitWorktreeNotFoundError('Git worktree not found in this project');
    }

    if (worktree.status === 'REMOVED') {
      return worktree; // Idempotent return for already removed worktrees
    }

    if (!worktree.workspace.gitRepoPath) {
      throw new GitRepositoryNotFoundError('Workspace Git repository path is not configured');
    }

    // Physically remove Git worktree first (throws GitWorktreeRemovalFailedError if git fails or is dirty)
    await gitService.removeWorktree({
      repositoryPath: worktree.workspace.gitRepoPath,
      worktreePath: worktree.path,
    });

    // Update database status to REMOVED only after successful Git removal
    return await prisma.gitWorktree.update({
      where: { id: worktreeId },
      data: { status: 'REMOVED' },
    });
  }
}

export const worktreeService = new WorktreeService();
