import { prisma } from '../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { WorkspaceStateDTO, ExecutionContextDTO } from '@agentmesh/shared';

export class WorkspaceService {
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

  async createWorkspace(projectId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const rootPath = `workspaces/${projectId}`;

    // Use upsert to rely on the database unique constraint for atomic concurrency safety
    return await prisma.projectWorkspace.upsert({
      where: { projectId },
      create: {
        projectId,
        rootPath,
      },
      update: {},
    });
  }

  async getWorkspace(projectId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const workspace = await prisma.projectWorkspace.findUnique({
      where: { projectId },
    });

    if (!workspace) {
      throw new NotFoundError('Workspace not found for this project');
    }

    return workspace;
  }

  async getWorkspaceState(projectId: string, userId: string): Promise<WorkspaceStateDTO> {
    await this.verifyProjectMembership(projectId, userId);

    // Ensure workspace exists (create if not initialized yet)
    const workspace = await prisma.projectWorkspace.upsert({
      where: { projectId },
      create: {
        projectId,
        rootPath: `workspaces/${projectId}`,
      },
      update: {},
    });

    const tasks = await prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        filePaths: true,
        responsibilities: {
          select: {
            agentId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      projectId,
      workspace: {
        id: workspace.id,
      },
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        responsibleAgentIds: t.responsibilities.map((r) => r.agentId),
        filePaths: t.filePaths || [],
      })),
    };
  }

  async updateGitRepoPath(projectId: string, userId: string, gitRepoPath: string | null) {
    await this.verifyProjectMembership(projectId, userId);

    const workspace = await this.getWorkspace(projectId, userId);

    if (gitRepoPath) {
      const { worktreeService } = await import('../git/worktree.service.js');
      worktreeService.assertPathContained(workspace.rootPath, gitRepoPath);
      const { gitService } = await import('../git/git.service.js');
      await gitService.validateRepository(gitRepoPath);
    }

    return await prisma.projectWorkspace.update({
      where: { projectId },
      data: { gitRepoPath },
    });
  }

  async getExecutionContext(
    projectId: string,
    taskId: string,
    executionId?: string,
  ): Promise<ExecutionContextDTO> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found in this project');
    }

    const workspace = await prisma.projectWorkspace.upsert({
      where: { projectId },
      create: {
        projectId,
        rootPath: `workspaces/${projectId}`,
      },
      update: {},
    });

    let workingDirectory = workspace.rootPath;

    if (executionId) {
      const activeWorktree = await prisma.gitWorktree.findFirst({
        where: {
          executionId,
          status: 'ACTIVE',
        },
      });

      if (activeWorktree) {
        workingDirectory = activeWorktree.path;
      }
    }

    return {
      projectId,
      workspaceId: workspace.id,
      rootPath: workspace.rootPath,
      workingDirectory,
    };
  }
}

export const workspaceService = new WorkspaceService();
