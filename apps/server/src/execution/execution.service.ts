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

  private async syncAgentStatus(agentId: string): Promise<void> {
    const activeExecutionsCount = await prisma.taskExecution.count({
      where: {
        agentId,
        status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING] },
      },
    });

    if (activeExecutionsCount === 0) {
      await prisma.agent.update({
        where: { id: agentId },
        data: { status: 'ONLINE' },
      });

      // Post-update re-check to guarantee zero race condition where an execution
      // became active (QUEUED or RUNNING) concurrently during the ONLINE update window.
      const recheckActiveCount = await prisma.taskExecution.count({
        where: {
          agentId,
          status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING] },
        },
      });

      if (recheckActiveCount > 0) {
        await prisma.agent.update({
          where: { id: agentId },
          data: { status: 'BUSY' },
        });
      }
    } else {
      await prisma.agent.update({
        where: { id: agentId },
        data: { status: 'BUSY' },
      });
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

    const { dependencyService } = await import('../services/dependency.service.js');
    const depResolution = await dependencyService.resolveTaskDependencies(
      projectId,
      taskId,
      userId,
    );
    if (!depResolution.ready) {
      const { BadRequestError } = await import('../errors/app-error.js');
      throw new BadRequestError('Task dependencies are not satisfied');
    }

    // Policy Evaluation Gate
    const { policyService } = await import('../services/policy.service.js');
    const evaluation = await policyService.evaluateAction(projectId, 'task.execute', {
      userId,
      agentId: data.agentId,
    });

    if (evaluation.decision === 'DENY') {
      throw new ForbiddenError('Action rejected by project policy');
    }

    if (evaluation.decision === 'APPROVAL_REQUIRED') {
      const { approvalService } = await import('../services/approval.service.js');
      const matchedPolicy = evaluation.matchedPolicies[0];
      const approvalRequest = await approvalService.createApprovalRequest(projectId, userId, {
        projectId,
        action: 'task.execute',
        policyId: matchedPolicy?.id || null,
        agentId: data.agentId,
        reason: `Action task.execute requires human approval per policy '${matchedPolicy?.name || 'default'}'`,
        metadata: {
          taskId,
          agentId: data.agentId,
          input: data.input || null,
        },
      });

      const { ApprovalRequiredError } = await import('../errors/app-error.js');
      throw new ApprovalRequiredError(
        approvalRequest.id,
        approvalRequest,
        'Execution blocked pending human approval',
      );
    }

    return await this.createExecutionBypassingPolicy(projectId, taskId, userId, data);
  }

  async createExecutionBypassingPolicy(
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

    const { dependencyService } = await import('../services/dependency.service.js');
    const depResolution = await dependencyService.resolveTaskDependencies(
      projectId,
      taskId,
      userId,
    );
    if (!depResolution.ready) {
      const { BadRequestError } = await import('../errors/app-error.js');
      throw new BadRequestError('Task dependencies are not satisfied');
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

    // Mark agent BUSY immediately upon creating a QUEUED execution
    await prisma.agent.update({
      where: { id: data.agentId },
      data: { status: 'BUSY' },
    });

    // Asynchronously trigger execution pipeline (fire-and-forget, zero unhandled rejections)
    void this.runExecutionPipeline(execution.id, data.input || null).catch((err) => {
      console.error(`Background execution pipeline error for ${execution.id}:`, err);
    });

    // Return created execution immediately with QUEUED status
    return execution;
  }

  public async runExecutionPipeline(
    executionId: string,
    rawInput: Record<string, unknown> | null,
  ): Promise<void> {
    try {
      const execution = await prisma.taskExecution.findUnique({
        where: { id: executionId },
      });

      if (!execution) {
        return;
      }

      // Check if execution was already cancelled
      if (execution.status === ExecutionStatus.CANCELLED) {
        return;
      }

      // 1. Atomic/conditional transition QUEUED -> RUNNING (and Task -> IN_PROGRESS if latest)
      let queuedToRunningCount = 0;
      await prisma.$transaction(async (tx) => {
        const updateResult = await tx.taskExecution.updateMany({
          where: {
            id: executionId,
            status: ExecutionStatus.QUEUED,
          },
          data: {
            status: ExecutionStatus.RUNNING,
            startedAt: new Date(),
          },
        });

        queuedToRunningCount = updateResult.count;

        if (queuedToRunningCount > 0) {
          const latestAtStart = await tx.taskExecution.findFirst({
            where: { taskId: execution.taskId },
            orderBy: { createdAt: 'desc' },
          });
          if (latestAtStart && latestAtStart.id === executionId) {
            await tx.task.update({
              where: { id: execution.taskId },
              data: { status: 'IN_PROGRESS' },
            });
          }
        }
      });

      if (queuedToRunningCount === 0) {
        // Conditional update affected 0 rows (execution is no longer QUEUED)
        const currentExec = await prisma.taskExecution.findUnique({
          where: { id: executionId },
        });

        if (currentExec?.status === ExecutionStatus.CANCELLED) {
          await this.syncAgentStatus(execution.agentId);
        }
        return;
      }

      // Update Agent status -> BUSY
      await prisma.agent.update({
        where: { id: execution.agentId },
        data: { status: 'BUSY' },
      });

      // 2. Resolve Workspace Execution Context
      let context;
      try {
        const taskObj = await prisma.task.findUnique({
          where: { id: execution.taskId },
          select: { projectId: true },
        });
        if (taskObj) {
          const workspace = await prisma.projectWorkspace.findUnique({
            where: { projectId: taskObj.projectId },
          });
          if (workspace?.gitRepoPath && execution.id) {
            const activeWt = await prisma.gitWorktree.findFirst({
              where: { executionId: execution.id, status: 'ACTIVE' },
            });
            if (!activeWt) {
              const project = await prisma.project.findUnique({
                where: { id: taskObj.projectId },
                select: { ownerId: true },
              });
              if (project?.ownerId) {
                const { worktreeService } = await import('../git/worktree.service.js');
                await worktreeService.createWorktree(taskObj.projectId, execution.id, project.ownerId).catch(() => null);
              }
            }
          }
          const { workspaceService } = await import('../workspace/workspace.service.js');
          context = await workspaceService.getExecutionContext(
            taskObj.projectId,
            execution.taskId,
            execution.id,
          );
        }
      } catch (ctxErr) {
        console.error(`Failed to resolve workspace context for execution ${executionId}:`, ctxErr);
      }

      // 3. Check if BYOA agent is connected via WebSocket connector
      try {
        const taskObj = await prisma.task.findUnique({
          where: { id: execution.taskId },
          select: { projectId: true },
        });
        if (taskObj) {
          const { connectorService } = await import('../connector/connector.service.js');
          const dispatched = await connectorService.dispatchTaskToAgent(
            taskObj.projectId,
            execution.taskId,
            execution.id,
            execution.agentId,
          );
          if (dispatched) {
            return;
          }
        }
      } catch (connErr) {
        console.error(`Failed to dispatch execution ${executionId} via connector:`, connErr);
      }

      // 4. Invoke Executor
      const result = await this.executor.execute({
        executionId: execution.id,
        taskId: execution.taskId,
        agentId: execution.agentId,
        input: rawInput,
        context,
      });

      // 3. Race Safety Check: verify execution was not cancelled while executor was running
      const currentExec = await prisma.taskExecution.findUnique({
        where: { id: executionId },
      });

      if (!currentExec || currentExec.status === ExecutionStatus.CANCELLED) {
        await this.syncAgentStatus(execution.agentId);
        return;
      }

      // 4. Atomic/conditional transition RUNNING -> COMPLETED or FAILED (and Task -> COMPLETED or FAILED if latest)
      const targetStatus =
        result.status === 'COMPLETED' ? ExecutionStatus.COMPLETED : ExecutionStatus.FAILED;

      let finishCount = 0;
      await prisma.$transaction(async (tx) => {
        const finishUpdateResult = await tx.taskExecution.updateMany({
          where: {
            id: executionId,
            status: ExecutionStatus.RUNNING,
          },
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

        finishCount = finishUpdateResult.count;

        if (finishCount > 0) {
          // Task State Integration: check if this execution is the latest execution for the task
          const latestExecution = await tx.taskExecution.findFirst({
            where: { taskId: execution.taskId },
            orderBy: { createdAt: 'desc' },
          });

          if (latestExecution && latestExecution.id === executionId) {
            await tx.task.update({
              where: { id: execution.taskId },
              data: {
                status: targetStatus === ExecutionStatus.COMPLETED ? 'COMPLETED' : 'FAILED',
              },
            });
          }
        }
      });

      if (finishCount === 0) {
        // Conditional update affected 0 rows (execution was cancelled concurrently)
        await this.syncAgentStatus(execution.agentId);
        return;
      }

      // Agent Status Integration: check if agent has remaining active executions
      await this.syncAgentStatus(execution.agentId);
    } catch (err: unknown) {
      console.error(`Error in runExecutionPipeline for execution ${executionId}:`, err);
      try {
        const currentExec = await prisma.taskExecution.findUnique({
          where: { id: executionId },
        });

        if (
          currentExec &&
          currentExec.status !== ExecutionStatus.CANCELLED &&
          currentExec.status !== ExecutionStatus.COMPLETED
        ) {
          const errorMessage =
            err instanceof Error ? err.message : 'Execution failed unexpectedly';

          await prisma.$transaction(async (tx) => {
            const finishUpdateResult = await tx.taskExecution.updateMany({
              where: {
                id: executionId,
                status: ExecutionStatus.RUNNING,
              },
              data: {
                status: ExecutionStatus.FAILED,
                error: errorMessage,
                completedAt: new Date(),
              },
            });

            if (finishUpdateResult.count > 0) {
              const latestExecution = await tx.taskExecution.findFirst({
                where: { taskId: currentExec.taskId },
                orderBy: { createdAt: 'desc' },
              });

              if (latestExecution && latestExecution.id === executionId) {
                await tx.task.update({
                  where: { id: currentExec.taskId },
                  data: { status: 'FAILED' },
                });
              }
            }
          });

          // Sync agent
          await this.syncAgentStatus(currentExec.agentId);
        }
      } catch (cleanupErr) {
        console.error(`Failed to handle error state for execution ${executionId}:`, cleanupErr);
      }
    }
  }

  async cancelExecution(
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
    });

    if (!execution || execution.taskId !== taskId) {
      throw new NotFoundError('Execution not found');
    }

    this.validateStateTransition(execution.status, ExecutionStatus.CANCELLED);

    await prisma.$transaction(async (tx) => {
      const cancelUpdateResult = await tx.taskExecution.updateMany({
        where: {
          id: executionId,
          status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING] },
        },
        data: {
          status: ExecutionStatus.CANCELLED,
          completedAt: new Date(),
        },
      });

      if (cancelUpdateResult.count === 0) {
        // Execution was no longer QUEUED or RUNNING (e.g., completed concurrently)
        const currentExec = await tx.taskExecution.findUnique({
          where: { id: executionId },
        });

        throw new ConflictError(
          `Invalid execution state transition from '${currentExec?.status || execution.status}' to 'CANCELLED'`,
        );
      }

      // Sync task state if latest
      const latestExecution = await tx.taskExecution.findFirst({
        where: { taskId },
        orderBy: { createdAt: 'desc' },
      });

      if (latestExecution && latestExecution.id === executionId) {
        await tx.task.update({
          where: { id: taskId },
          data: { status: 'CANCELLED' },
        });
      }
    });

    const updated = await prisma.taskExecution.findUniqueOrThrow({
      where: { id: executionId },
      include: {
        agent: true,
        task: true,
      },
    });

    // Sync agent status
    await this.syncAgentStatus(execution.agentId);

    // Notify connected BYOA agent if active
    try {
      const { connectorService } = await import('../connector/connector.service.js');
      await connectorService.notifyTaskCancelled(
        projectId,
        taskId,
        executionId,
        execution.agentId,
      );
    } catch {
      // Ignore connector notification failures
    }

    return updated;
  }

  async updateExecutionStatus(
    projectId: string,
    taskId: string,
    executionId: string,
    userId: string,
    targetStatus: ExecutionStatus,
    error?: string,
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

    const updated = await prisma.$transaction(async (tx) => {
      const updatedExec = await tx.taskExecution.update({
        where: { id: executionId },
        data: {
          status: targetStatus,
          ...(error !== undefined && { error }),
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
      const latestExecution = await tx.taskExecution.findFirst({
        where: { taskId },
        orderBy: { createdAt: 'desc' },
      });

      if (latestExecution && latestExecution.id === executionId) {
        if (targetStatus === ExecutionStatus.RUNNING) {
          await tx.task.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS' } });
        } else if (targetStatus === ExecutionStatus.COMPLETED) {
          await tx.task.update({ where: { id: taskId }, data: { status: 'COMPLETED' } });
        } else if (targetStatus === ExecutionStatus.FAILED) {
          await tx.task.update({ where: { id: taskId }, data: { status: 'FAILED' } });
        } else if (targetStatus === ExecutionStatus.CANCELLED) {
          await tx.task.update({ where: { id: taskId }, data: { status: 'CANCELLED' } });
        }
      }

      return updatedExec;
    });

    // Apply Agent status sync
    await this.syncAgentStatus(execution.agentId);

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

