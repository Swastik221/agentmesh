import {
  AgentMeshMessage,
  AgentMeshMessageType,
  createAgentMeshMessage,
  parseAgentMeshMessage,
} from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { ConnectionMetadata } from '../websocket/websocket.types.js';
import { executionService } from '../execution/execution.service.js';
import { ExecutionStatus } from '@prisma/client';
import { logger } from '../lib/logger.js';

export interface ProcessConnectorMessageResult {
  success: boolean;
  error?: AgentMeshMessage;
}

export class ConnectorService {
  public async dispatchTaskToAgent(
    projectId: string,
    taskId: string,
    executionId: string,
    agentId: string,
  ): Promise<boolean> {
    const connections = connectionManager.getAuthenticatedAgentConnections(agentId);
    if (connections.length === 0) {
      return false;
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      return false;
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { capabilities: true },
    });

    if (!agent) {
      return false;
    }

    const taskRequestMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_REQUEST,
      projectId,
      senderId: 'server',
      recipientId: agentId,
      payload: {
        taskId,
        executionId,
        title: task.title,
        description: task.description,
        requiredCapabilities: agent.capabilities.map((c) => c.capability.trim().toLowerCase()),
        metadata: {
          priority: task.priority,
          filePaths: task.filePaths || [],
        },
      },
    });

    const dataString = JSON.stringify(taskRequestMsg);
    let sentCount = 0;

    for (const conn of connections) {
      if (conn.socket.readyState === conn.socket.OPEN) {
        conn.socket.send(dataString);
        sentCount++;
      }
    }

    return sentCount > 0;
  }

  public isAgentConnected(agentId: string): boolean {
    const connections = connectionManager.getAuthenticatedAgentConnections(agentId);
    return connections.some((c) => c.socket.readyState === c.socket.OPEN);
  }

  public async notifyTaskCancelled(
    projectId: string,
    taskId: string,
    executionId: string,
    agentId: string,
  ): Promise<boolean> {
    const connections = connectionManager.getAuthenticatedAgentConnections(agentId);
    if (connections.length === 0) {
      return false;
    }

    const cancelMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_STATUS,
      projectId,
      senderId: 'server',
      recipientId: agentId,
      payload: {
        taskId,
        executionId,
        status: 'CANCELLED',
        message: 'Execution cancelled by server',
      },
    });

    const dataString = JSON.stringify(cancelMsg);
    let sentCount = 0;

    for (const conn of connections) {
      if (conn.socket.readyState === conn.socket.OPEN) {
        conn.socket.send(dataString);
        sentCount++;
      }
    }

    return sentCount > 0;
  }

  public async processConnectorTaskMessage(
    metadata: ConnectionMetadata,
    rawMessage: unknown,
  ): Promise<ProcessConnectorMessageResult> {
    if (!metadata.authenticated || !metadata.agentId || !metadata.userId) {
      return {
        success: false,
        error: createAgentMeshMessage({
          type: AgentMeshMessageType.ERROR,
          projectId: metadata.projectId,
          senderId: 'server',
          payload: {
            code: 'AUTHENTICATION_FAILED',
            message: 'Connection must complete handshake before sending connector task messages',
          },
        }),
      };
    }

    let message: AgentMeshMessage;
    try {
      message = parseAgentMeshMessage(rawMessage);
    } catch (err: unknown) {
      const msgText = err instanceof Error ? err.message : 'Invalid message';
      return {
        success: false,
        error: createAgentMeshMessage({
          type: AgentMeshMessageType.ERROR,
          projectId: metadata.projectId,
          senderId: 'server',
          payload: {
            code: 'INVALID_MESSAGE',
            message: msgText,
          },
        }),
      };
    }

    // Verify Project Isolation
    if (message.projectId !== metadata.projectId) {
      return {
        success: false,
        error: createAgentMeshMessage({
          type: AgentMeshMessageType.ERROR,
          projectId: metadata.projectId,
          senderId: 'server',
          payload: {
            code: 'AUTHORIZATION_FAILED',
            message: `Message projectId '${message.projectId}' does not match connection project '${metadata.projectId}'`,
          },
        }),
      };
    }

    // Verify Agent Ownership / Operating Authority
    if (message.senderId !== metadata.agentId) {
      return {
        success: false,
        error: createAgentMeshMessage({
          type: AgentMeshMessageType.ERROR,
          projectId: metadata.projectId,
          senderId: 'server',
          payload: {
            code: 'AGENT_NOT_AUTHORIZED',
            message: `Connection is registered to agent '${metadata.agentId}', cannot send message as '${message.senderId}'`,
          },
        }),
      };
    }

    switch (message.type) {
      case AgentMeshMessageType.TASK_ACCEPTED: {
        const { taskId, executionId } = message.payload;
        if (executionId) {
          try {
            await executionService.updateExecutionStatus(
              metadata.projectId,
              taskId,
              executionId,
              metadata.userId,
              ExecutionStatus.RUNNING,
            );
          } catch {
            // If already RUNNING or invalid transition, continue gracefully
          }
        }
        return { success: true };
      }

      case AgentMeshMessageType.TASK_COMPLETED: {
        const { taskId, executionId, result } = message.payload;
        const targetExecId = executionId || (await this.findActiveExecutionId(taskId, metadata.agentId));

        if (!targetExecId) {
          return {
            success: false,
            error: createAgentMeshMessage({
              type: AgentMeshMessageType.ERROR,
              projectId: metadata.projectId,
              senderId: 'server',
              payload: {
                code: 'EXECUTION_NOT_FOUND',
                message: `No active execution found for task '${taskId}'`,
              },
            }),
          };
        }

        try {
          await executionService.updateExecutionStatus(
            metadata.projectId,
            taskId,
            targetExecId,
            metadata.userId,
            ExecutionStatus.COMPLETED,
          );

          // Update result output on execution record if provided
          if (result !== undefined && result !== null) {
            await prisma.taskExecution.update({
              where: { id: targetExecId },
              data: { output: result as unknown as import('@prisma/client').Prisma.InputJsonValue },
            }).catch(() => {});
          }
        } catch (err: unknown) {
          // Idempotency: if execution is already terminal or cancelled, do not throw
          logger.info(`Connector TASK_COMPLETED handled idempotently for ${targetExecId}: ${String(err)}`);
        }
        return { success: true };
      }

      case AgentMeshMessageType.TASK_FAILED: {
        const { taskId, executionId, error } = message.payload;
        const targetExecId = executionId || (await this.findActiveExecutionId(taskId, metadata.agentId));

        if (!targetExecId) {
          return {
            success: false,
            error: createAgentMeshMessage({
              type: AgentMeshMessageType.ERROR,
              projectId: metadata.projectId,
              senderId: 'server',
              payload: {
                code: 'EXECUTION_NOT_FOUND',
                message: `No active execution found for task '${taskId}'`,
              },
            }),
          };
        }

        try {
          await executionService.updateExecutionStatus(
            metadata.projectId,
            taskId,
            targetExecId,
            metadata.userId,
            ExecutionStatus.FAILED,
          );

          await prisma.taskExecution.update({
            where: { id: targetExecId },
            data: { error },
          }).catch(() => {});
        } catch (err: unknown) {
          logger.info(`Connector TASK_FAILED handled idempotently for ${targetExecId}: ${String(err)}`);
        }
        return { success: true };
      }

      case AgentMeshMessageType.TASK_REJECTED: {
        return { success: true };
      }

      case AgentMeshMessageType.TASK_PROGRESS: {
        // Agents stream progress while working. Progress is live-only (not
        // persisted as a column); web clients use it to render the working
        // state without polling. Task state itself remains server-owned.
        const { taskId, executionId, progress, message: progressMessage } =
          message.payload as {
            taskId?: string;
            executionId?: string;
            progress?: number;
            message?: string;
          };
        if (!taskId) {
          return {
            success: false,
            error: createAgentMeshMessage({
              type: AgentMeshMessageType.ERROR,
              projectId: metadata.projectId,
              senderId: 'server',
              payload: {
                code: 'INVALID_MESSAGE',
                message: "task.progress requires 'taskId'",
              },
            }),
          };
        }
        let currentStatus: string = 'IN_PROGRESS';
        try {
          const currentTask = await prisma.task.findUnique({
            where: { id: taskId },
            select: { status: true },
          });
          currentStatus = currentTask?.status ?? 'IN_PROGRESS';
        } catch {
          // Best-effort status lookup; fall back to IN_PROGRESS.
        }
        connectionManager.broadcastToProject(metadata.projectId, {
          type: AgentMeshMessageType.TASK_STATUS,
          payload: {
            taskId,
            ...(executionId && { executionId }),
            status: currentStatus,
            ...(typeof progress === 'number' && { progress }),
            ...(progressMessage !== undefined &&
              progressMessage.trim() !== '' && { message: progressMessage.trim() }),
          },
        });
        return { success: true };
      }

      case AgentMeshMessageType.TASK_STATUS: {
        // Agents may report status updates; the server is the authority on
        // task state, so this is acknowledged and ignored (prevents an
        // UNKNOWN_MESSAGE_TYPE error round-trip on the agent socket).
        return { success: true };
      }

      default:
        return {
          success: false,
          error: createAgentMeshMessage({
            type: AgentMeshMessageType.ERROR,
            projectId: metadata.projectId,
            senderId: 'server',
            payload: {
              code: 'UNKNOWN_MESSAGE_TYPE',
              message: `Unsupported message type '${message.type}' for connector`,
            },
          }),
        };
    }
  }

  private async findActiveExecutionId(taskId: string, agentId: string): Promise<string | null> {
    const active = await prisma.taskExecution.findFirst({
      where: {
        taskId,
        agentId,
        status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return active ? active.id : null;
  }

  public async onAgentConnected(agentId: string, projectId: string): Promise<void> {
    // Find any QUEUED executions assigned to this agent in this project and dispatch them
    const queuedExecutions = await prisma.taskExecution.findMany({
      where: {
        agentId,
        status: ExecutionStatus.QUEUED,
        task: { projectId },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const exec of queuedExecutions) {
      await this.dispatchTaskToAgent(projectId, exec.taskId, exec.id, agentId);
    }
  }
}

export const connectorService = new ConnectorService();
