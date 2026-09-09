import { ProjectMember, ProjectRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
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
    await this.verifyProjectMembership(projectId, actorUserId);

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
        role: data.role || ProjectRole.MEMBER,
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
    await this.verifyProjectMembership(projectId, actorUserId);

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
    await this.verifyProjectMembership(projectId, actorUserId);

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
    });
  }
}

export const memberService = new MemberService();
