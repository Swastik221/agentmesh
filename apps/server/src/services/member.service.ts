import { ProjectMember, ProjectRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getProjectRole } from '../auth/project-access.js';
import { AddMemberInput, UpdateMemberRoleInput } from '../schemas/member.schema.js';
import { ConflictError, NotFoundError, ForbiddenError } from '../errors/app-error.js';

export class MemberService {
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

  async addMember(projectId: string, actorUserId: string, data: AddMemberInput): Promise<ProjectMember> {
    const actorRole = await getProjectRole(projectId, actorUserId);
    if (actorRole !== ProjectRole.OWNER && actorRole !== ProjectRole.ADMIN) {
      throw new ForbiddenError('Only a project OWNER or ADMIN can add members');
    }
    const requestedRole = data.role || ProjectRole.MEMBER;
    if (
      (requestedRole === ProjectRole.OWNER || requestedRole === ProjectRole.ADMIN) &&
      actorRole !== ProjectRole.OWNER
    ) {
      throw new ForbiddenError('Only a project OWNER can grant the OWNER or ADMIN role');
    }

    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) {
      throw new NotFoundError(`User with ID '${data.userId}' not found`);
    }

    const existingMember = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: data.userId,
        },
      },
    });

    if (existingMember) {
      throw new ConflictError('User is already a member of this project');
    }

    return await prisma.projectMember.create({
      data: {
        projectId,
        userId: data.userId,
        role: requestedRole,
      },
    });
  }

  async getProjectMembers(projectId: string, actorUserId: string) {
    await this.verifyProjectMembership(projectId, actorUserId);

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: true,
      },
    });

    return members.map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      walletAddress: m.user.walletAddress,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async updateMemberRole(
    projectId: string,
    userId: string,
    actorUserId: string,
    data: UpdateMemberRoleInput,
  ): Promise<ProjectMember> {
    const actorRole = await getProjectRole(projectId, actorUserId);
    if (actorRole !== ProjectRole.OWNER) {
      throw new ForbiddenError('Only a project OWNER can change member roles');
    }

    return await prisma.$transaction(async (tx) => {
      // Row-level lock on the project to ensure concurrency-safe OWNER invariant enforcement
      const projects = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "projects" WHERE id = ${projectId} FOR UPDATE
      `;

      if (!projects || projects.length === 0) {
        throw new NotFoundError(`Project with ID '${projectId}' not found`);
      }

      const member = await tx.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
            userId,
          },
        },
      });

      if (!member) {
        throw new NotFoundError(
          `Membership for user '${userId}' in project '${projectId}' not found`,
        );
      }

      if (member.role === ProjectRole.OWNER && data.role === ProjectRole.MEMBER) {
        const ownerCount = await tx.projectMember.count({
          where: {
            projectId,
            role: ProjectRole.OWNER,
          },
        });

        if (ownerCount <= 1) {
          throw new ConflictError(
            'Cannot demote the only project OWNER. A project must have at least one OWNER.',
          );
        }
      }

      return await tx.projectMember.update({
        where: {
          projectId_userId: {
            projectId,
            userId,
          },
        },
        data: {
          role: data.role,
        },
      });
    });
  }

  async removeMember(
    projectId: string,
    userId: string,
    actorUserId: string,
  ): Promise<{ message: string }> {
    const actorRole = await getProjectRole(projectId, actorUserId);
    const isSelf = userId === actorUserId;
    if (!isSelf && actorRole !== ProjectRole.OWNER && actorRole !== ProjectRole.ADMIN) {
      throw new ForbiddenError('Only a project OWNER or ADMIN can remove other members');
    }

    return await prisma.$transaction(async (tx) => {
      // Row-level lock on the project to ensure concurrency-safe OWNER invariant enforcement
      const projects = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "projects" WHERE id = ${projectId} FOR UPDATE
      `;

      if (!projects || projects.length === 0) {
        throw new NotFoundError(`Project with ID '${projectId}' not found`);
      }

      const member = await tx.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
            userId,
          },
        },
      });

      if (!member) {
        throw new NotFoundError(
          `Membership for user '${userId}' in project '${projectId}' not found`,
        );
      }

      // An ADMIN may remove MEMBERs and VIEWERs, but not peers or owners.
      if (
        !isSelf &&
        actorRole === ProjectRole.ADMIN &&
        (member.role === ProjectRole.OWNER || member.role === ProjectRole.ADMIN)
      ) {
        throw new ForbiddenError('Only a project OWNER can remove an OWNER or ADMIN');
      }

      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (project?.ownerId === userId && !isSelf) {
        throw new ForbiddenError('The project creator cannot be removed by another member');
      }

      if (member.role === ProjectRole.OWNER) {
        const ownerCount = await tx.projectMember.count({
          where: {
            projectId,
            role: ProjectRole.OWNER,
          },
        });

        if (ownerCount <= 1) {
          throw new ConflictError(
            'Cannot remove the only project OWNER. A project must have at least one OWNER.',
          );
        }
      }

      await tx.projectMember.delete({
        where: {
          projectId_userId: {
            projectId,
            userId,
          },
        },
      });

      return { message: 'Member removed successfully' };
    }).then(async (result) => {
      // Access ends now, not at their next reconnect: close their browser
      // tabs (and with them any terminal subscriptions) and the connections
      // of agents they run in this project.
      const { connectionManager } = await import('../websocket/connection.manager.js');
      connectionManager.closeUserProjectConnections(projectId, userId, 4003, 'Removed from workspace');
      return result;
    });
  }
}

export const memberService = new MemberService();
