import { Prisma, ExecutionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { CreateTaskExecutionInput, ListExecutionsQuery } from './execution.schemas.js';
import { mockAgentExecutor } from './executors/mock-agent-executor.js';
import { AgentExecutor } from './executors/agent-executor.js';
import { deltaSequencerService } from '../services/delta-sequencer.service.js';
import { taskService } from '../tasks/task.service.js';

export class ExecutionService {
  private executor: AgentExecutor = mockAgentExecutor;

  public setExecutor(executor: AgentExecutor): void {
    this.executor = executor;
  }

  /**
   * Broadcasts a real execution status transition as a sequenced
   * `workspace.delta` (`entity: 'execution'`), the same mechanism
   * `task.service.ts` already uses for `task`/`taskResponsibility`.
   * `execution` is already a valid entity in the protocol's delta schema
   * (`workspaceDeltaChangeSchema`), so no new protocol surface is needed.
   * No raw immediate broadcast alongside it: unlike `task.service.ts`'s
   * `TASK_STATUS`, there is no existing raw message type for execution
   * status that any consumer (agent or frontend) reads today, so this
   * would be new protocol surface, which is out of scope here. Called only
   * after the owning transaction has committed, matching every other
   * broadcast call site in this codebase, so a rolled-back transition is
   * never announced.
   */
  private async broadcastExecutionStatus(
    projectId: string,
    executionId: string,
    taskId: string,
    agentId: string,
    status: ExecutionStatus,
    operation: 'created' | 'updated',
  ): Promise<void> {
    await deltaSequencerService.recordAndBroadcastDelta(projectId, [
      {
        entity: 'execution',
        entityId: executionId,
        operation,
        fields: { taskId, agentId, status },
      },
    ]);
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

    let finalStatus: 'ONLINE' | 'BUSY';

    if (activeExecutionsCount === 0) {
      await prisma.agent.update({
        where: { id: agentId },
        data: { status: 'ONLINE' },
      });
      finalStatus = 'ONLINE';

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
        finalStatus = 'BUSY';
      }
    } else {
      await prisma.agent.update({
        where: { id: agentId },
        data: { status: 'BUSY' },
      });
      finalStatus = 'BUSY';
    }

    // This ONLINE/BUSY flip (driven by execution activity, not a direct
    // human edit) previously broadcast nothing at all, confirmed by grep
    // showing zero broadcast/delta calls anywhere in agent.service.ts and
    // this file alike: a project member watching a real-time agent roster
    // never saw an agent go BUSY when it picked up work, or back ONLINE
    // when it finished, without an unrelated refetch.
    const agentForBroadcast = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { projectId: true },
    });
    if (agentForBroadcast) {
      await deltaSequencerService.recordAndBroadcastDelta(agentForBroadcast.projectId, [
        {
          entity: 'agent',
          entityId: agentId,
          operation: 'updated',
          fields: { status: finalStatus },
        },
      ]);
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
    const evaluation = await policyService.evaluateAction(projectId, 'task.execute');

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
        idempotencyKey: `task.execute:${taskId}`,
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
    await deltaSequencerService.recordAndBroadcastDelta(projectId, [
      { entity: 'agent', entityId: data.agentId, operation: 'updated', fields: { status: 'BUSY' } },
    ]);

    await this.broadcastExecutionStatus(
      projectId,
      execution.id,
      taskId,
      data.agentId,
      ExecutionStatus.QUEUED,
      'created',
    );

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

      const owningTask = await prisma.task.findUnique({
        where: { id: execution.taskId },
        select: { projectId: true },
      });
      const projectId = owningTask?.projectId;

      // 1. Atomic/conditional transition QUEUED -> RUNNING (and Task -> IN_PROGRESS if latest)
      let queuedToRunningCount = 0;
      let taskSyncedToInProgress = false;
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
            taskSyncedToInProgress = true;
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

      if (projectId) {
        await this.broadcastExecutionStatus(
          projectId,
          executionId,
          execution.taskId,
          execution.agentId,
          ExecutionStatus.RUNNING,
          'updated',
        );
        if (taskSyncedToInProgress) {
          await taskService.broadcastTaskStatusEvent(projectId, execution.taskId, 'IN_PROGRESS');
        }
      }

      // Update Agent status -> BUSY
      await prisma.agent.update({
        where: { id: execution.agentId },
        data: { status: 'BUSY' },
      }).catch(() => null);
      if (projectId) {
        await deltaSequencerService.recordAndBroadcastDelta(projectId, [
          { entity: 'agent', entityId: execution.agentId, operation: 'updated', fields: { status: 'BUSY' } },
        ]);
      }

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
      let dispatched = false;
      try {
        if (projectId) {
          const { connectorService } = await import('../connector/connector.service.js');
          dispatched = await connectorService.dispatchTaskToAgent(
            projectId,
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

      const isRequireRealAgent =
        Boolean(rawInput?.requireRealAgent) ||
        (typeof execution.input === 'object' &&
          execution.input !== null &&
          (execution.input as Record<string, unknown>).requireRealAgent === true);

      if (isRequireRealAgent) {
        // Enforce strict no-mock policy for paid capabilities: fail execution if agent is disconnected
        await prisma.$transaction(async (tx) => {
          await tx.taskExecution.updateMany({
            where: {
              id: executionId,
              status: ExecutionStatus.RUNNING,
            },
            data: {
              status: ExecutionStatus.FAILED,
              error: 'Agent is not connected via WebSocket',
              completedAt: new Date(),
            },
          });
          const latestExecution = await tx.taskExecution.findFirst({
            where: { taskId: execution.taskId },
            orderBy: { createdAt: 'desc' },
          });
          if (latestExecution && latestExecution.id === executionId) {
            await tx.task.update({
              where: { id: execution.taskId },
              data: { status: 'FAILED' },
            });
          }
        });

        if (projectId) {
          await this.broadcastExecutionStatus(
            projectId,
            executionId,
            execution.taskId,
            execution.agentId,
            ExecutionStatus.FAILED,
            'updated',
          );
          await taskService.broadcastTaskStatusEvent(projectId, execution.taskId, 'FAILED');
        }

        await this.syncAgentStatus(execution.agentId);
        return;
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
      let finishTaskStatus: 'COMPLETED' | 'FAILED' | null = null;
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
            finishTaskStatus = targetStatus === ExecutionStatus.COMPLETED ? 'COMPLETED' : 'FAILED';
            await tx.task.update({
              where: { id: execution.taskId },
              data: {
                status: finishTaskStatus,
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

      if (projectId) {
        await this.broadcastExecutionStatus(
          projectId,
          executionId,
          execution.taskId,
          execution.agentId,
          targetStatus,
          'updated',
        );
        if (finishTaskStatus) {
          await taskService.broadcastTaskStatusEvent(projectId, execution.taskId, finishTaskStatus);
        }
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

          let cleanupFinishCount = 0;
          let cleanupTaskSynced = false;
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

            cleanupFinishCount = finishUpdateResult.count;

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
                cleanupTaskSynced = true;
              }
            }
          });

          if (cleanupFinishCount > 0) {
            const owningTaskForCleanup = await prisma.task.findUnique({
              where: { id: currentExec.taskId },
              select: { projectId: true },
            });
            if (owningTaskForCleanup) {
              await this.broadcastExecutionStatus(
                owningTaskForCleanup.projectId,
                executionId,
                currentExec.taskId,
                currentExec.agentId,
                ExecutionStatus.FAILED,
                'updated',
              );
              if (cleanupTaskSynced) {
                await taskService.broadcastTaskStatusEvent(
                  owningTaskForCleanup.projectId,
                  currentExec.taskId,
                  'FAILED',
                );
              }
            }
          }

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

    let taskSyncedToCancelled = false;
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
        taskSyncedToCancelled = true;
      }
    });

    const updated = await prisma.taskExecution.findUniqueOrThrow({
      where: { id: executionId },
      include: {
        agent: true,
        task: true,
      },
    });

    // Reaching here means the transaction committed (a 0-row update throws
    // ConflictError above and rolls back), so the cancellation is real.
    await this.broadcastExecutionStatus(
      projectId,
      executionId,
      taskId,
      execution.agentId,
      ExecutionStatus.CANCELLED,
      'updated',
    );
    if (taskSyncedToCancelled) {
      await taskService.broadcastTaskStatusEvent(projectId, taskId, 'CANCELLED');
    }

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

    let syncedTaskStatus: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | null = null;
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
          syncedTaskStatus = 'IN_PROGRESS';
        } else if (targetStatus === ExecutionStatus.COMPLETED) {
          syncedTaskStatus = 'COMPLETED';
        } else if (targetStatus === ExecutionStatus.FAILED) {
          syncedTaskStatus = 'FAILED';
        } else if (targetStatus === ExecutionStatus.CANCELLED) {
          syncedTaskStatus = 'CANCELLED';
        }
        if (syncedTaskStatus) {
          await tx.task.update({ where: { id: taskId }, data: { status: syncedTaskStatus } });
        }
      }

      return updatedExec;
    });

    // This is the connector's own status-report path (agent-reported
    // TASK_ACCEPTED/TASK_COMPLETED/TASK_FAILED/TASK_REJECTED), the one path
    // besides the executor pipeline that changes a real execution's status;
    // confirmed by grep it previously broadcast nothing at all.
    await this.broadcastExecutionStatus(
      projectId,
      executionId,
      taskId,
      execution.agentId,
      targetStatus,
      'updated',
    );
    if (syncedTaskStatus) {
      await taskService.broadcastTaskStatusEvent(projectId, taskId, syncedTaskStatus);
    }

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

