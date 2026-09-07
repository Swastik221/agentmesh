import { Prisma } from '@prisma/client';
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

  async createTask(projectId: string, userId: string, data: CreateTaskInput) {
    await this.verifyProjectMembership(projectId, userId);

    return await prisma.task.create({
      data: {
        projectId,
        creatorId: userId,
        title: data.title,
        description: data.description,
        priority: data.priority,
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

    const updateData: Prisma.TaskUpdateInput = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;

    return await prisma.task.update({
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

    try {
      return await prisma.taskResponsibility.create({
        data: {
          taskId,
          agentId: data.agentId,
          role: data.role || null,
        },
        include: {
          agent: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError('Agent is already assigned to this task');
      }
      throw error;
    }
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
