import { Prisma, ExecutionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { CreateTaskExecutionInput, ListExecutionsQuery } from './execution.schemas.js';
import { mockAgentExecutor } from './executors/mock-agent-executor.js';
import { AgentExecutor } from './executors/agent-executor.js';

export class ExecutionService {
  private executor: AgentExecutor = mockAgentExecutor;

  public setExecutor(executor: AgentExecutor): void {
    this.executor = executor;
  }

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

  private validateStateTransition(
    currentStatus: ExecutionStatus,
    targetStatus: ExecutionStatus,
  ): void {
    const allowedTransitions: Record<ExecutionStatus, ExecutionStatus[]> = {
      QUEUED: ['RUNNING', 'CANCELLED'],
      RUNNING: ['COMPLETED', 'FAILED', 'CANCELLED'],
      COMPLETED: [],
      FAILED: [],
      CANCELLED: [],
    };

    const allowed = allowedTransitions[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      throw new ConflictError(
        `Invalid execution state transition from '${currentStatus}' to '${targetStatus}'`,
      );
    }
  }

  async createExecution(
    projectId: string,
    taskId: string,
    userId: string,
    data: CreateTaskExecutionInput,
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

    const responsibility = await prisma.taskResponsibility.findUnique({
      where: {
        taskId_agentId: {
          taskId,
          agentId: data.agentId,
        },
      },
    });

    if (!responsibility) {
      throw new ForbiddenError('Agent is not assigned responsibility for this task');
    }

    const execution = await prisma.taskExecution.create({
      data: {
        taskId,
        agentId: data.agentId,
        status: ExecutionStatus.QUEUED,
        input:
          data.input !== undefined && data.input !== null
            ? (data.input as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
      include: {
        agent: true,
        task: true,
      },
    });

    // Run execution pipeline synchronously for deterministic processing
    await this.runExecutionPipeline(execution.id, data.input || null);

    // Return latest execution state
    return await prisma.taskExecution.findUniqueOrThrow({
      where: { id: execution.id },
      include: {
        agent: true,
        task: true,
      },
    });
  }

  public async runExecutionPipeline(
    executionId: string,
    rawInput: Record<string, unknown> | null,
  ): Promise<void> {
    const execution = await prisma.taskExecution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      return;
    }

    // 1. Transition QUEUED -> RUNNING
    this.validateStateTransition(execution.status, ExecutionStatus.RUNNING);
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    // Update Task status -> IN_PROGRESS
    await prisma.task.update({
      where: { id: execution.taskId },
      data: { status: 'IN_PROGRESS' },
    });

    // Update Agent status -> BUSY
    await prisma.agent.update({
      where: { id: execution.agentId },
      data: { status: 'BUSY' },
    });

    // 2. Invoke Executor
    const result = await this.executor.execute({
      executionId: execution.id,
      taskId: execution.taskId,
      agentId: execution.agentId,
      input: rawInput,
    });

    // 3. Transition RUNNING -> COMPLETED or FAILED
    const targetStatus =
      result.status === 'COMPLETED' ? ExecutionStatus.COMPLETED : ExecutionStatus.FAILED;

    const currentExec = await prisma.taskExecution.findUniqueOrThrow({
      where: { id: executionId },
    });

    this.validateStateTransition(currentExec.status, targetStatus);

    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: targetStatus,
        output:
          result.output !== undefined && result.output !== null
            ? (result.output as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        error: result.error || null,
        completedAt: new Date(),
      },
    });

    // Task State Integration: check if this execution is the latest execution for the task
    const latestExecution = await prisma.taskExecution.findFirst({
      where: { taskId: execution.taskId },
      orderBy: { createdAt: 'desc' },
    });

    if (latestExecution && latestExecution.id === executionId) {
      await prisma.task.update({
        where: { id: execution.taskId },
        data: {
          status: targetStatus === ExecutionStatus.COMPLETED ? 'COMPLETED' : 'FAILED',
        },
      });
    }

    // Agent Status Integration: check if agent has remaining active executions
    const activeExecutionsCount = await prisma.taskExecution.count({
      where: {
        agentId: execution.agentId,
        status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING] },
      },
    });

    if (activeExecutionsCount === 0) {
      await prisma.agent.update({
        where: { id: execution.agentId },
        data: { status: 'ONLINE' },
      });
    }
  }

  async updateExecutionStatus(
    projectId: string,
    taskId: string,
    executionId: string,
    userId: string,
    targetStatus: ExecutionStatus,
  ) {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const execution = await prisma.taskExecution.findUnique({
      where: { id: executionId },
    });

    if (!execution || execution.taskId !== taskId) {
      throw new NotFoundError('Execution not found');
    }

    this.validateStateTransition(execution.status, targetStatus);

    const updated = await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: targetStatus,
        ...(targetStatus === ExecutionStatus.RUNNING && { startedAt: new Date() }),
        ...((targetStatus === ExecutionStatus.COMPLETED ||
          targetStatus === ExecutionStatus.FAILED ||
          targetStatus === ExecutionStatus.CANCELLED) && {
          completedAt: new Date(),
        }),
      },
      include: {
        agent: true,
        task: true,
      },
    });

    // Apply Task state sync if latest
    const latestExecution = await prisma.taskExecution.findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });

    if (latestExecution && latestExecution.id === executionId) {
      if (targetStatus === ExecutionStatus.RUNNING) {
        await prisma.task.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS' } });
      } else if (targetStatus === ExecutionStatus.COMPLETED) {
        await prisma.task.update({ where: { id: taskId }, data: { status: 'COMPLETED' } });
      } else if (targetStatus === ExecutionStatus.FAILED) {
        await prisma.task.update({ where: { id: taskId }, data: { status: 'FAILED' } });
      } else if (targetStatus === ExecutionStatus.CANCELLED) {
        await prisma.task.update({ where: { id: taskId }, data: { status: 'CANCELLED' } });
      }
    }

    // Apply Agent status sync
    const activeExecutionsCount = await prisma.taskExecution.count({
      where: {
        agentId: execution.agentId,
        status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING] },
      },
    });

    if (activeExecutionsCount === 0) {
      await prisma.agent.update({
        where: { id: execution.agentId },
        data: { status: 'ONLINE' },
      });
    }

    return updated;
  }

  async listExecutions(
    projectId: string,
    taskId: string,
    userId: string,
    query: ListExecutionsQuery,
  ) {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [executions, total] = await prisma.$transaction([
      prisma.taskExecution.findMany({
        where: { taskId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          agent: true,
        },
      }),
      prisma.taskExecution.count({ where: { taskId } }),
    ]);

    return {
      items: executions,
      page,
      limit,
      total,
    };
  }

  async getExecution(
    projectId: string,
    taskId: string,
    executionId: string,
    userId: string,
  ) {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const execution = await prisma.taskExecution.findUnique({
      where: { id: executionId },
      include: {
        agent: true,
        task: true,
      },
    });

    if (!execution || execution.taskId !== taskId) {
      throw new NotFoundError('Execution not found');
    }

    return execution;
  }
}

export const executionService = new ExecutionService();
