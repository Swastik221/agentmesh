import { Prisma, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../errors/app-error.js';
import {
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksQuery,
  AssignResponsibilityInput,
  CreateDependencyInput,
} from './task.schemas.js';
import { validateFilePaths } from '../workspace/file-path.validator.js';
import { assertNoFileConflicts } from '../workspace/conflict-detector.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { AgentMeshMessageType } from '@agentmesh/agent-protocol';

const creatorSelect = {
  id: true,
  walletAddress: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
};

export class TaskService {
  private async verifyProjectMembership(projectId: string, userId: string): Promise<void> {
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

  public broadcastTaskStatusEvent(projectId: string, taskId: string, status: TaskStatus): void {
    connectionManager.broadcastToProject(projectId, {
      type: AgentMeshMessageType.TASK_STATUS,
      payload: {
        taskId,
        status,
      },
    });
  }

  async createTask(projectId: string, userId: string, data: CreateTaskInput) {
    await this.verifyProjectMembership(projectId, userId);

    const validatedFilePaths = validateFilePaths(data.filePaths);

    const createdTask = await prisma.task.create({
      data: {
        projectId,
        creatorId: userId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        filePaths: validatedFilePaths,
      },
      include: {
        creator: {
          select: creatorSelect,
        },
        responsibilities: {
          include: {
            agent: true,
          },
        },
        dependencies: true,
      },
    });

    this.broadcastTaskStatusEvent(projectId, createdTask.id, createdTask.status);

    return createdTask;
  }

  async listTasks(projectId: string, userId: string, query: ListTasksQuery) {
    await this.verifyProjectMembership(projectId, userId);

    const where: Prisma.TaskWhereInput = {
      projectId,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.priority) {
      where.priority = query.priority;
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [tasks, total] = await prisma.$transaction([
      prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          creator: {
            select: creatorSelect,
          },
          responsibilities: {
            include: {
              agent: true,
            },
          },
          dependencies: true,
        },
      }),
      prisma.task.count({ where }),
    ]);

    return {
      items: tasks,
      page,
      limit,
      total,
    };
  }

  async getTask(projectId: string, taskId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: {
          select: creatorSelect,
        },
        responsibilities: {
          include: {
            agent: true,
          },
        },
        dependencies: true,
      },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    return task;
  }

  async updateTask(projectId: string, taskId: string, userId: string, data: UpdateTaskInput) {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const validatedFilePaths =
      data.filePaths !== undefined ? validateFilePaths(data.filePaths) : undefined;

    const updateData: Prisma.TaskUpdateInput = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (validatedFilePaths !== undefined) updateData.filePaths = validatedFilePaths;

    const updatedTask = await prisma.$transaction(async (tx) => {
      // Execute PostgreSQL row lock on project tasks to guarantee concurrency safety
      await tx.$executeRaw`SELECT * FROM tasks WHERE "projectId" = ${projectId} FOR UPDATE`;

      const freshTask = await tx.task.findUnique({
        where: { id: taskId },
      });

      if (!freshTask || freshTask.projectId !== projectId) {
        throw new NotFoundError('Task not found');
      }

      const targetStatus = data.status !== undefined ? data.status : freshTask.status;
      const targetFilePaths =
        validatedFilePaths !== undefined ? validatedFilePaths : freshTask.filePaths;

      if (targetStatus === 'IN_PROGRESS') {
        await assertNoFileConflicts(projectId, taskId, targetFilePaths, tx);
      }

      return await tx.task.update({
        where: { id: taskId },
        data: updateData,
        include: {
          creator: {
            select: creatorSelect,
          },
          responsibilities: {
            include: {
              agent: true,
            },
          },
          dependencies: true,
        },
      });
    });

    if (data.status !== undefined && updatedTask.status !== task.status) {
      this.broadcastTaskStatusEvent(projectId, taskId, updatedTask.status);
    }

    return updatedTask;
  }

  async deleteTask(projectId: string, taskId: string, userId: string): Promise<void> {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    await prisma.task.delete({
      where: { id: taskId },
    });
  }

  // Task Responsibilities
  async assignResponsibility(
    projectId: string,
    taskId: string,
    userId: string,
    data: AssignResponsibilityInput,
  ) {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const agent = await prisma.agent.findUnique({
      where: { id: data.agentId },
    });

    if (!agent) {
      throw new NotFoundError('Agent not found');
    }

    if (agent.projectId !== projectId) {
      throw new ForbiddenError('Agent does not belong to this project');
    }

    const existing = await prisma.taskResponsibility.findUnique({
      where: {
        taskId_agentId: {
          taskId,
          agentId: data.agentId,
        },
      },
    });

    if (existing) {
      throw new ConflictError('Agent is already assigned to this task');
    }

    return await prisma.$transaction(async (tx) => {
      // Execute PostgreSQL row lock on project tasks to guarantee concurrency safety
      await tx.$executeRaw`SELECT * FROM tasks WHERE "projectId" = ${projectId} FOR UPDATE`;

      // Refetch target task inside transaction after acquiring row lock to ensure fresh DB state (filePaths)
      const freshTask = await tx.task.findUnique({
        where: { id: taskId },
      });

      if (!freshTask || freshTask.projectId !== projectId) {
        throw new NotFoundError('Task not found');
      }

      // Assert no conflict with existing IN_PROGRESS tasks using fresh filePaths
      await assertNoFileConflicts(projectId, taskId, freshTask.filePaths, tx);

      try {
        const responsibility = await tx.taskResponsibility.create({
          data: {
            taskId,
            agentId: data.agentId,
            role: data.role || null,
          },
          include: {
            agent: true,
          },
        });

        return responsibility;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictError('Agent is already assigned to this task');
        }
        throw error;
      }
    });
  }

  async listResponsibilities(projectId: string, taskId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    return await prisma.taskResponsibility.findMany({
      where: { taskId },
      include: {
        agent: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async removeResponsibility(
    projectId: string,
    taskId: string,
    agentId: string,
    userId: string,
  ): Promise<void> {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const responsibility = await prisma.taskResponsibility.findUnique({
      where: {
        taskId_agentId: {
          taskId,
          agentId,
        },
      },
    });

    if (!responsibility) {
      throw new NotFoundError('Responsibility not found');
    }

    await prisma.taskResponsibility.delete({
      where: {
        taskId_agentId: {
          taskId,
          agentId,
        },
      },
    });
  }

  // Task Dependencies
  async addDependency(
    projectId: string,
    taskId: string,
    userId: string,
    data: CreateDependencyInput,
  ) {
    await this.verifyProjectMembership(projectId, userId);

    if (taskId === data.dependsOnTaskId) {
      throw new BadRequestError('A task cannot depend on itself');
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const dependsOnTask = await prisma.task.findUnique({
      where: { id: data.dependsOnTaskId },
    });

    if (!dependsOnTask || dependsOnTask.projectId !== projectId) {
      throw new NotFoundError('Dependent task not found in this project');
    }

    const existing = await prisma.taskDependency.findUnique({
      where: {
        taskId_dependsOnTaskId: {
          taskId,
          dependsOnTaskId: data.dependsOnTaskId,
        },
      },
    });

    if (existing) {
      throw new ConflictError('Dependency already exists');
    }

    try {
      return await prisma.taskDependency.create({
        data: {
          taskId,
          dependsOnTaskId: data.dependsOnTaskId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError('Dependency already exists');
      }
      throw error;
    }
  }

  async listDependencies(projectId: string, taskId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    return await prisma.taskDependency.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async removeDependency(
    projectId: string,
    taskId: string,
    dependsOnTaskId: string,
    userId: string,
  ): Promise<void> {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const dependency = await prisma.taskDependency.findUnique({
      where: {
        taskId_dependsOnTaskId: {
          taskId,
          dependsOnTaskId,
        },
      },
    });

    if (!dependency) {
      throw new NotFoundError('Dependency not found');
    }

    await prisma.taskDependency.delete({
      where: {
        taskId_dependsOnTaskId: {
          taskId,
          dependsOnTaskId,
        },
      },
    });
  }
}

export const taskService = new TaskService();
