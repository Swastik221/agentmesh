import { ProjectMember, ProjectRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AddMemberInput, UpdateMemberRoleInput } from '../schemas/member.schema.js';
import { ConflictError, NotFoundError } from '../errors/app-error.js';

export class MemberService {
  async addMember(projectId: string, data: AddMemberInput): Promise<ProjectMember> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
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
        role: data.role || ProjectRole.MEMBER,
      },
    });
  }

  async getProjectMembers(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

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
    data: UpdateMemberRoleInput,
  ): Promise<ProjectMember> {
    const member = await prisma.projectMember.findUnique({
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
      const ownerCount = await prisma.projectMember.count({
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

    return await prisma.projectMember.update({
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
  }

  async removeMember(projectId: string, userId: string): Promise<{ message: string }> {
    const member = await prisma.projectMember.findUnique({
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
      const ownerCount = await prisma.projectMember.count({
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

    await prisma.projectMember.delete({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    return { message: 'Member removed successfully' };
  }
}

export const memberService = new MemberService();
