import { Prisma, ApprovalStatus, ApprovalRequest } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { CreateApprovalRequestInput, ListApprovalsQuery } from '../schemas/approval.schema.js';
import { connectionManager } from '../websocket/connection.manager.js';
import type { WebSocketMessage } from '../websocket/websocket.types.js';
import { activityService } from './activity.service.js';

export class ApprovalService {
  async verifyProjectMembership(projectId: string, userId: string): Promise<void> {
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

  async createApprovalRequest(
    projectId: string,
    requestedByUserId: string,
    data: CreateApprovalRequestInput,
  ): Promise<ApprovalRequest> {
    await this.verifyProjectMembership(projectId, requestedByUserId);

    // Idempotency check: if metadata contains taskId or operationId, look for existing PENDING request
    const meta = data.metadata as Record<string, unknown> | null;
    const taskId = typeof meta?.taskId === 'string' ? meta.taskId : undefined;
    const operationId = typeof meta?.operationId === 'string' ? meta.operationId : undefined;

    if (taskId || operationId) {
      const existingPending = await prisma.approvalRequest.findFirst({
        where: {
          projectId,
          action: data.action,
          status: ApprovalStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingPending) {
        const existingMeta = existingPending.metadata as Record<string, unknown> | null;
        if (
          (taskId && existingMeta?.taskId === taskId) ||
          (operationId && existingMeta?.operationId === operationId)
        ) {
          return existingPending;
        }
      }
    }

    const approval = await prisma.approvalRequest.create({
      data: {
        projectId,
        requestedByUserId,
        action: data.action,
        policyId: data.policyId || null,
        agentId: data.agentId || null,
        reason: data.reason || null,
        metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        status: ApprovalStatus.PENDING,
      },
      include: {
        policy: true,
        requestedByUser: true,
        agent: true,
      },
    });

    // Notify WS subscribers & activity log
    try {
      await activityService.recordActivity(projectId, {
        type: 'approval.created',
        actorType: 'human',
        actorId: requestedByUserId,
        payload: {
          approvalId: approval.id,
          action: approval.action,
          status: approval.status,
        },
      });
      connectionManager.broadcastToProject(projectId, {
        type: 'approval.created',
        payload: approval,
      } as unknown as WebSocketMessage);
    } catch {
      // Activity/WS log is best-effort
    }

    return approval;
  }

  async getApprovalRequest(approvalId: string, userId: string): Promise<ApprovalRequest> {
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: {
        project: true,
        policy: true,
        requestedByUser: true,
        resolvedByUser: true,
        agent: true,
      },
    });

    if (!approval) {
      throw new NotFoundError(`Approval request with ID '${approvalId}' not found`);
    }

    await this.verifyProjectMembership(approval.projectId, userId);

    return approval;
  }

  async listApprovalRequests(
    userId: string,
    query: ListApprovalsQuery,
  ): Promise<{ requests: ApprovalRequest[]; total: number; page: number; limit: number }> {
    let projectIds: string[] = [];

    if (query.projectId) {
      await this.verifyProjectMembership(query.projectId, userId);
      projectIds = [query.projectId];
    } else {
      const memberships = await prisma.projectMember.findMany({
        where: { userId },
        select: { projectId: true },
      });
      projectIds = memberships.map((m) => m.projectId);
    }

    if (projectIds.length === 0) {
      return { requests: [], total: 0, page: query.page || 1, limit: query.limit || 20 };
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ApprovalRequestWhereInput = {
      projectId: { in: projectIds },
      ...(query.status && { status: query.status }),
    };

    const [requests, total] = await Promise.all([
      prisma.approvalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          policy: true,
          requestedByUser: true,
          resolvedByUser: true,
          agent: true,
        },
      }),
      prisma.approvalRequest.count({ where }),
    ]);

    return { requests, total, page, limit };
  }

  async approveRequest(
    approvalId: string,
    userId: string,
    reason?: string,
  ): Promise<ApprovalRequest> {
    // Atomic state transition checking PENDING state to prevent double-approval / race conditions
    const updatedApproval = await prisma.$transaction(async (tx) => {
      const existing = await tx.approvalRequest.findUnique({
        where: { id: approvalId },
      });

      if (!existing) {
        throw new NotFoundError(`Approval request with ID '${approvalId}' not found`);
      }

      // Authorization check
      const membership = await tx.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: existing.projectId,
            userId,
          },
        },
      });

      if (!membership) {
        throw new ForbiddenError('User is not a member of this project');
      }

      if (existing.status !== ApprovalStatus.PENDING) {
        throw new ConflictError(`Cannot approve request in status '${existing.status}'`);
      }

      const updateResult = await tx.approvalRequest.updateMany({
        where: {
          id: approvalId,
          status: ApprovalStatus.PENDING,
        },
        data: {
          status: ApprovalStatus.APPROVED,
          resolvedByUserId: userId,
          resolvedAt: new Date(),
          reason: reason || existing.reason,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictError('Approval request was modified concurrently');
      }

      const resolved = await tx.approvalRequest.findUnique({
        where: { id: approvalId },
        include: {
          policy: true,
          requestedByUser: true,
          resolvedByUser: true,
          agent: true,
        },
      });

      return resolved!;
    });

    // Notify WS subscribers & activity log
    try {
      await activityService.recordActivity(updatedApproval.projectId, {
        type: 'approval.approved',
        actorType: 'human',
        actorId: userId,
        payload: {
          approvalId: updatedApproval.id,
          action: updatedApproval.action,
          status: updatedApproval.status,
        },
      });
      connectionManager.broadcastToProject(updatedApproval.projectId, {
        type: 'approval.approved',
        payload: updatedApproval,
      } as unknown as WebSocketMessage);
    } catch {
      // Activity/WS log is best-effort
    }

    // Approval Resume: Execute original blocked action if payload is stored in metadata
    await this.resumeBlockedAction(updatedApproval, userId);

    return updatedApproval;
  }

  async rejectRequest(
    approvalId: string,
    userId: string,
    reason?: string,
  ): Promise<ApprovalRequest> {
    const updatedApproval = await prisma.$transaction(async (tx) => {
      const existing = await tx.approvalRequest.findUnique({
        where: { id: approvalId },
      });

      if (!existing) {
        throw new NotFoundError(`Approval request with ID '${approvalId}' not found`);
      }

      const membership = await tx.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: existing.projectId,
            userId,
          },
        },
      });

      if (!membership) {
        throw new ForbiddenError('User is not a member of this project');
      }

      if (existing.status !== ApprovalStatus.PENDING) {
        throw new ConflictError(`Cannot reject request in status '${existing.status}'`);
      }

      const updateResult = await tx.approvalRequest.updateMany({
        where: {
          id: approvalId,
          status: ApprovalStatus.PENDING,
        },
        data: {
          status: ApprovalStatus.REJECTED,
          resolvedByUserId: userId,
          resolvedAt: new Date(),
          reason: reason || existing.reason,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictError('Approval request was modified concurrently');
      }

      const resolved = await tx.approvalRequest.findUnique({
        where: { id: approvalId },
        include: {
          policy: true,
          requestedByUser: true,
          resolvedByUser: true,
          agent: true,
        },
      });

      return resolved!;
    });

    try {
      await activityService.recordActivity(updatedApproval.projectId, {
        type: 'approval.rejected',
        actorType: 'human',
        actorId: userId,
        payload: {
          approvalId: updatedApproval.id,
          action: updatedApproval.action,
          status: updatedApproval.status,
        },
      });
      connectionManager.broadcastToProject(updatedApproval.projectId, {
        type: 'approval.rejected',
        payload: updatedApproval,
      } as unknown as WebSocketMessage);
    } catch {
      // Activity/WS log is best-effort
    }

    return updatedApproval;
  }

  private async resumeBlockedAction(approval: ApprovalRequest, userId: string): Promise<void> {
    if (!approval.metadata || typeof approval.metadata !== 'object') {
      return;
    }

    const meta = approval.metadata as Record<string, unknown>;

    try {
      if (approval.action === 'task.execute' || approval.action === 'agent.execute') {
        const taskId = typeof meta.taskId === 'string' ? meta.taskId : undefined;
        const agentId = typeof meta.agentId === 'string' ? meta.agentId : undefined;
        const input = (meta.input as Record<string, unknown>) || undefined;

        if (taskId && agentId) {
          const { executionService } = await import('../execution/execution.service.js');
          await executionService.createExecutionBypassingPolicy(
            approval.projectId,
            taskId,
            userId,
            { agentId, input },
          );
        }
      } else if (approval.action === 'artifact.write') {
        const taskId = typeof meta.taskId === 'string' ? meta.taskId : undefined;
        const artifactData = meta.artifactData as import('./artifact.service.js').CreateArtifactInput | undefined;

        if (taskId && artifactData) {
          const { artifactService } = await import('./artifact.service.js');
          await artifactService.createArtifactBypassingPolicy(
            approval.projectId,
            taskId,
            userId,
            artifactData,
          );
        }
      }
    } catch (err) {
      console.error(`Failed to resume blocked action for approval ${approval.id}:`, err);
    }
  }
}

export const approvalService = new ApprovalService();
