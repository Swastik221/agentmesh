import { Prisma, ApprovalStatus, ApprovalRequest, ProjectRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getProjectRole, PROJECT_MANAGER_ROLES } from '../auth/project-access.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { CreateApprovalRequestInput, ListApprovalsQuery } from '../schemas/approval.schema.js';
import { connectionManager } from '../websocket/connection.manager.js';
import type { WebSocketMessage } from '../websocket/websocket.types.js';
import { activityService } from './activity.service.js';

const RESUMABLE_ACTIONS = new Set(['task.execute', 'agent.execute', 'capability.execute', 'artifact.write']);

/** Whether approving this request re-runs a blocked action. */
function isResumable(approval: Pick<ApprovalRequest, 'action' | 'metadata'>): boolean {
  return Boolean(approval.metadata && typeof approval.metadata === 'object' && RESUMABLE_ACTIONS.has(approval.action));
}

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

    // Cross-Project Referential Integrity Validation
    if (data.policyId) {
      const policy = await prisma.policy.findUnique({
        where: { id: data.policyId },
      });
      if (!policy || policy.projectId !== projectId) {
        throw new NotFoundError(`Policy with ID '${data.policyId}' not found in project '${projectId}'`);
      }
    }

    if (data.agentId) {
      const agent = await prisma.agent.findUnique({
        where: { id: data.agentId },
      });
      if (!agent || agent.projectId !== projectId) {
        throw new NotFoundError(`Agent with ID '${data.agentId}' not found in project '${projectId}'`);
      }
    }

    // Race-Safe Idempotency Check & Atomic Creation
    const idempotencyKey = data.idempotencyKey || null;

    if (idempotencyKey) {
      const existing = await prisma.approvalRequest.findUnique({
        where: {
          projectId_idempotencyKey: {
            projectId,
            idempotencyKey,
          },
        },
        include: {
          policy: true,
          requestedByUser: true,
          agent: true,
        },
      });

      if (existing && existing.status === ApprovalStatus.PENDING) {
        return existing;
      }
    }

    let approval: ApprovalRequest;
    try {
      approval = await prisma.approvalRequest.create({
        data: {
          projectId,
          requestedByUserId,
          action: data.action,
          policyId: data.policyId || null,
          agentId: data.agentId || null,
          idempotencyKey,
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
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        idempotencyKey
      ) {
        const existing = await prisma.approvalRequest.findUnique({
          where: {
            projectId_idempotencyKey: {
              projectId,
              idempotencyKey,
            },
          },
          include: {
            policy: true,
            requestedByUser: true,
            agent: true,
          },
        });
        if (existing) {
          return existing;
        }
      }
      throw err;
    }

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

      // Approval is the human check on a gated action, so it must come from
      // someone with authority over the project. An approval executes its
      // action bypassing policy, which means a plain MEMBER approving their
      // own request would let them skip any policy. OWNER and ADMIN may
      // approve their own requests: they can edit the policies anyway.
      const approverRole = await getProjectRole(existing.projectId, userId, tx);
      const isManager = PROJECT_MANAGER_ROLES.includes(approverRole);
      if (approverRole === ProjectRole.VIEWER) {
        throw new ForbiddenError('Viewers cannot approve requests');
      }
      if (existing.requestedByUserId === userId && !isManager) {
        throw new ForbiddenError(
          'You cannot approve your own request. Another member, or a project OWNER or ADMIN, must approve it.',
        );
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
          // Recorded with the decision: this approval owes a resumed action.
          resumeStatus: isResumable(existing) ? 'PENDING' : 'NOT_APPLICABLE',
          resumeAttempts: isResumable(existing) ? 1 : 0,
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

    // Resume the blocked action. Its outcome is written back to the approval
    // either way; a failure still propagates to the approver, and the
    // approval is left FAILED (retryable) rather than silently APPROVED.
    if (updatedApproval.resumeStatus === 'PENDING') {
      await this.runResume(updatedApproval);
    }

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

  /**
   * Runs the resumed action for an approval whose resumeStatus has already
   * been claimed as PENDING, and records DONE or FAILED.
   */
  private async runResume(approval: ApprovalRequest): Promise<string | null> {
    try {
      const resultId = await this.resumeBlockedAction(approval);
      await prisma.approvalRequest.update({
        where: { id: approval.id },
        data: { resumeStatus: 'DONE', resumeError: null, resumeResultId: resultId, resumedAt: new Date() },
      });
      return resultId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.approvalRequest
        .update({ where: { id: approval.id }, data: { resumeStatus: 'FAILED', resumeError: message.slice(0, 1000) } })
        .catch(() => {});
      throw err;
    }
  }

  /**
   * Retries the action of an approved request whose resume failed (or was
   * interrupted by a restart). Same authority as approving. The FAILED →
   * PENDING claim is atomic, so two concurrent retries cannot both run it.
   */
  async retryResume(approvalId: string, userId: string): Promise<ApprovalRequest> {
    const existing = await prisma.approvalRequest.findUnique({ where: { id: approvalId } });
    if (!existing) {
      throw new NotFoundError(`Approval request with ID '${approvalId}' not found`);
    }
    const role = await getProjectRole(existing.projectId, userId);
    if (role === ProjectRole.VIEWER) {
      throw new ForbiddenError('Viewers cannot retry approvals');
    }
    if (existing.requestedByUserId === userId && !PROJECT_MANAGER_ROLES.includes(role)) {
      throw new ForbiddenError('Another member, or a project OWNER or ADMIN, must retry your request.');
    }

    const claimed = await prisma.approvalRequest.updateMany({
      where: { id: approvalId, status: ApprovalStatus.APPROVED, resumeStatus: 'FAILED' },
      data: { resumeStatus: 'PENDING', resumeError: null, resumeAttempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new ConflictError('Nothing to retry: the approval is not approved with a failed action, or a retry is already running');
    }

    const approval = (await prisma.approvalRequest.findUnique({ where: { id: approvalId } }))!;
    await this.runResume(approval);
    return (await prisma.approvalRequest.findUnique({ where: { id: approvalId } }))!;
  }

  /**
   * A resume that was running when the server stopped did not finish. Mark it
   * FAILED so a human can retry it; it is never re-run automatically, since
   * creating an execution or artifact is not idempotent.
   */
  async reconcileOnStartup(): Promise<number> {
    const result = await prisma.approvalRequest.updateMany({
      where: { resumeStatus: 'PENDING' },
      data: { resumeStatus: 'FAILED', resumeError: 'Interrupted by a server restart. Retry it explicitly.' },
    });
    return result.count;
  }

  private async resumeBlockedAction(approval: ApprovalRequest): Promise<string | null> {
    if (!approval.metadata || typeof approval.metadata !== 'object') {
      return null;
    }

    if (
      approval.action !== 'task.execute' &&
      approval.action !== 'agent.execute' &&
      approval.action !== 'capability.execute' &&
      approval.action !== 'artifact.write'
    ) {
      throw new BadRequestError(`Unsupported action '${approval.action}' for automatic approval resumption`);
    }

    const meta = approval.metadata as Record<string, unknown>;

    // Use requestedByUserId (original requester), NOT the approver's userId!
    const originalRequesterUserId = approval.requestedByUserId;

    if (approval.action === 'task.execute' || approval.action === 'agent.execute') {
      const taskId = typeof meta.taskId === 'string' ? meta.taskId : undefined;
      const agentId = typeof meta.agentId === 'string' ? meta.agentId : undefined;
      const input = (meta.input as Record<string, unknown>) || undefined;

      if (!taskId || !agentId) {
        throw new BadRequestError('Invalid approval metadata for task execution resumption');
      }

      const { executionService } = await import('../execution/execution.service.js');
      const execution = await executionService.createExecutionBypassingPolicy(
        approval.projectId,
        taskId,
        originalRequesterUserId,
        { agentId, input },
      );
      return execution.id;
    } else if (approval.action === 'artifact.write') {
      const taskId = typeof meta.taskId === 'string' ? meta.taskId : undefined;
      const artifactData = meta.artifactData as import('./artifact.service.js').CreateArtifactInput | undefined;

      if (!taskId || !artifactData) {
        throw new BadRequestError('Invalid approval metadata for artifact creation resumption');
      }

      const { artifactService } = await import('./artifact.service.js');
      const artifact = await artifactService.createArtifactBypassingPolicy(
        approval.projectId,
        taskId,
        originalRequesterUserId,
        artifactData,
      );
      return artifact.id;
    }
    return null;
  }
}

export const approvalService = new ApprovalService();
