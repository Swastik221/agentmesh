import { ProjectRole, InvitationStatus, ProjectInvitation } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/app-error.js';
import { CreateInvitationInput } from '../schemas/invitation.schema.js';
import { ensService } from './ens.service.js';
import { connectionManager } from '../websocket/connection.manager.js';
import type { WebSocketMessage } from '../websocket/websocket.types.js';
import { activityService } from './activity.service.js';

export class InvitationService {
  async verifyProjectMemberRole(
    projectId: string,
    userId: string,
    allowedRoles: ProjectRole[],
  ): Promise<void> {
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

    const isOwner = project.ownerId === userId;

    if (isOwner) {
      return; // Project OWNER has implicit admin privileges for all actions
    }

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenError('Insufficient project permissions');
    }
  }

  async createInvitation(
    projectId: string,
    inviterUserId: string,
    data: CreateInvitationInput,
  ): Promise<ProjectInvitation> {
    // Only OWNER or ADMIN may invite teammates (Section 8)
    await this.verifyProjectMemberRole(projectId, inviterUserId, [
      ProjectRole.OWNER,
      ProjectRole.ADMIN,
    ]);

    // Resolve target (wallet address or ENS name) (Section 8)
    const target = data.target.trim();
    let canonicalWallet: string | null = null;

    if (/^0x[a-fA-F0-9]{40}$/.test(target)) {
      canonicalWallet = target.toLowerCase();
    } else {
      // Resolve ENS name using existing resolver
      try {
        const resolvedAddress = await ensService.resolveName(target);
        if (resolvedAddress) {
          canonicalWallet = resolvedAddress.toLowerCase();
        }
      } catch {
        canonicalWallet = null;
      }
    }

    if (!canonicalWallet) {
      throw new BadRequestError(`Invalid EVM wallet address or unresolvable ENS name '${target}'`);
    }

    // Check if target user is ALREADY a project member
    const existingMemberUser = await prisma.user.findFirst({
      where: {
        walletAddress: {
          equals: canonicalWallet,
          mode: 'insensitive',
        },
      },
    });

    if (existingMemberUser) {
      const existingMembership = await prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
            userId: existingMemberUser.id,
          },
        },
      });

      if (existingMembership) {
        throw new ConflictError('User is already a member of this project');
      }
    }

    // Idempotency: Check if pending invitation already exists for same project and wallet
    const existingPending = await prisma.projectInvitation.findFirst({
      where: {
        projectId,
        invitedWallet: canonicalWallet,
        status: InvitationStatus.PENDING,
      },
    });

    if (existingPending) {
      return existingPending;
    }

    try {
      const invitation = await prisma.projectInvitation.create({
        data: {
          projectId,
          inviterUserId,
          invitedWallet: canonicalWallet,
          role: data.role || ProjectRole.MEMBER,
          status: InvitationStatus.PENDING,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        },
        include: {
          project: true,
          inviterUser: true,
        },
      });

      // WS broadcast & Activity log
      try {
        await activityService.recordActivity(projectId, {
          type: 'invitation.created',
          actorType: 'human',
          actorId: inviterUserId,
          payload: {
            invitationId: invitation.id,
            invitedWallet: invitation.invitedWallet,
            role: invitation.role,
          },
        });
        connectionManager.broadcastToProject(projectId, {
          type: 'invitation.created',
          payload: invitation,
        } as unknown as WebSocketMessage);
      } catch {
        // Activity/WS log is best effort
      }

      return invitation;
    } catch (err: unknown) {
      // If DB unique constraint fails due to concurrent creation
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
        const found = await prisma.projectInvitation.findFirst({
          where: {
            projectId,
            invitedWallet: canonicalWallet,
            status: InvitationStatus.PENDING,
          },
        });
        if (found) return found;
      }
      throw err;
    }
  }

  async listPendingInvitationsForUser(userId: string): Promise<ProjectInvitation[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.walletAddress) {
      return [];
    }

    const canonicalWallet = user.walletAddress.toLowerCase();

    return await prisma.projectInvitation.findMany({
      where: {
        invitedWallet: canonicalWallet,
        status: InvitationStatus.PENDING,
      },
      include: {
        project: true,
        inviterUser: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listProjectInvitations(
    projectId: string,
    userId: string,
  ): Promise<ProjectInvitation[]> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
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

    return await prisma.projectInvitation.findMany({
      where: { projectId },
      include: { inviterUser: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acceptInvitation(invitationId: string, userId: string): Promise<ProjectInvitation> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.walletAddress) {
      throw new UnauthorizedError('User wallet address is required to accept invitation');
    }

    const invitation = await prisma.projectInvitation.findUnique({
      where: { id: invitationId },
      include: { project: true },
    });

    if (!invitation) {
      throw new NotFoundError(`Invitation with ID '${invitationId}' not found`);
    }

    // Security Verification: Authenticated wallet MUST match invited wallet (Section 10)
    if (user.walletAddress.toLowerCase() !== invitation.invitedWallet.toLowerCase()) {
      throw new ForbiddenError('Authenticated wallet does not match invitation recipient');
    }

    // Check expiry
    if (invitation.status === InvitationStatus.EXPIRED || (invitation.expiresAt && invitation.expiresAt < new Date())) {
      if (invitation.status !== InvitationStatus.EXPIRED) {
        await prisma.projectInvitation.update({
          where: { id: invitationId },
          data: { status: InvitationStatus.EXPIRED },
        }).catch(() => {});
      }
      throw new BadRequestError('Invitation has expired');
    }

    if (invitation.status !== InvitationStatus.PENDING && invitation.status !== InvitationStatus.ACCEPTED) {
      throw new ConflictError(`Invitation is no longer pending (status: '${invitation.status}')`);
    }

    // Atomic membership creation/verification (Idempotent via unique constraint on projectId_userId)
    try {
      await prisma.projectMember.upsert({
        where: {
          projectId_userId: {
            projectId: invitation.projectId,
            userId,
          },
        },
        create: {
          projectId: invitation.projectId,
          userId,
          role: invitation.role,
        },
        update: {},
      });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
        const existingMember = await prisma.projectMember.findUnique({
          where: {
            projectId_userId: {
              projectId: invitation.projectId,
              userId,
            },
          },
        });
        if (!existingMember) {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // Atomic invitation status transition from PENDING -> ACCEPTED
    let wasUpdated = false;
    if (invitation.status === InvitationStatus.PENDING) {
      const result = await prisma.projectInvitation.updateMany({
        where: {
          id: invitationId,
          status: InvitationStatus.PENDING,
        },
        data: {
          status: InvitationStatus.ACCEPTED,
        },
      });
      wasUpdated = result.count > 0;
    }

    const finalInvitation = await prisma.projectInvitation.findUnique({
      where: { id: invitationId },
      include: {
        project: true,
        inviterUser: true,
      },
    });

    if (!finalInvitation) {
      throw new NotFoundError(`Invitation with ID '${invitationId}' not found`);
    }

    // WS & Activity notifications (only if this invocation performed the transition)
    if (wasUpdated) {
      try {
        await activityService.recordActivity(invitation.projectId, {
          type: 'invitation.accepted',
          actorType: 'human',
          actorId: userId,
          payload: {
            invitationId: invitation.id,
            role: invitation.role,
          },
        });
        connectionManager.broadcastToProject(invitation.projectId, {
          type: 'member.added',
          payload: {
            projectId: invitation.projectId,
            userId,
            role: invitation.role,
          },
        } as unknown as WebSocketMessage);
      } catch {
        // Activity/WS log is best effort
      }
    }

    return finalInvitation;
  }

  async declineInvitation(invitationId: string, userId: string): Promise<ProjectInvitation> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.walletAddress) {
      throw new UnauthorizedError('User wallet address is required to decline invitation');
    }

    const invitation = await prisma.projectInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new NotFoundError(`Invitation with ID '${invitationId}' not found`);
    }

    if (user.walletAddress.toLowerCase() !== invitation.invitedWallet.toLowerCase()) {
      throw new ForbiddenError('Authenticated wallet does not match invitation recipient');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new ConflictError(`Invitation is no longer pending (status: '${invitation.status}')`);
    }

    return await prisma.projectInvitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.DECLINED },
      include: { project: true, inviterUser: true },
    });
  }
}

export const invitationService = new InvitationService();
