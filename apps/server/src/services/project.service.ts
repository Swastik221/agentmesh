import crypto from 'node:crypto';
import { Project, ProjectRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateProjectInput, UpdateProjectInput } from '../schemas/project.schema.js';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/app-error.js';

/**
 * Join-code alphabet. Crockford-style: no I, L, O, U, so a code read aloud or
 * copied by hand cannot be confused between 1/I/L or 0/O.
 */
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
const JOIN_CODE_BODY_LENGTH = 8;

/**
 * The join code is owner-only: it is the credential for entering a workspace,
 * so it must never ride along on a general project payload where any member
 * (or anyone the payload is forwarded to) would see it. Every project-shaped
 * response strips it; only the dedicated owner-guarded endpoint returns it.
 */
function withoutJoinCode<T extends { joinCode?: string | null }>(project: T): Omit<T, 'joinCode'> {
  const { joinCode: _joinCode, ...rest } = project;
  void _joinCode;
  return rest;
}

function generateJoinCode(): string {
  const bytes = crypto.randomBytes(JOIN_CODE_BODY_LENGTH);
  let body = '';
  for (let i = 0; i < JOIN_CODE_BODY_LENGTH; i++) {
    body += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return `MESH-${body}`;
}

export class ProjectService {
  async createProject(data: CreateProjectInput): Promise<Project> {
    const owner = await prisma.user.findUnique({
      where: { id: data.ownerId },
    });
    if (!owner) {
      throw new NotFoundError(`Owner user with ID '${data.ownerId}' not found`);
    }

    return await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: data.name,
          description: data.description || null,
          ownerId: data.ownerId,
        },
      });

      await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId: data.ownerId,
          role: ProjectRole.OWNER,
        },
      });

      return withoutJoinCode(project) as Project;
    });
  }

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

  async getProjectById(id: string, actorUserId?: string) {
    if (actorUserId) {
      await this.verifyProjectMembership(id, actorUserId);
    }

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        owner: true,
        members: {
          include: {
            user: true,
          },
        },
        agents: true,
      },
    });

    if (!project) {
      throw new NotFoundError(`Project with ID '${id}' not found`);
    }

    return withoutJoinCode(project);
  }

  async getUserProjects(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundError(`User with ID '${userId}' not found`);
    }

    const memberships = await prisma.projectMember.findMany({
      where: { userId },
      include: {
        project: {
          include: {
            owner: true,
          },
        },
      },
    });

    return memberships.map((m) => ({
      ...withoutJoinCode(m.project),
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async updateProject(id: string, actorUserId: string, data: UpdateProjectInput): Promise<Project> {
    await this.verifyProjectMembership(id, actorUserId);

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });
    return withoutJoinCode(updated) as Project;
  }

  async deleteProject(id: string, actorUserId: string): Promise<{ message: string }> {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundError(`Project with ID '${id}' not found`);
    }

    if (project.ownerId !== actorUserId) {
      throw new ForbiddenError('Only the project owner can delete this project');
    }

    await prisma.project.delete({
      where: { id },
    });

    return { message: 'Project deleted successfully' };
  }

  /**
   * Returns the project's shareable join code, minting one on first use.
   * Owner only: handing out workspace access is the owner's decision, so a
   * plain member cannot read (and therefore cannot share) the code.
   */
  async getOrCreateJoinCode(projectId: string, actorUserId: string): Promise<string> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }
    if (project.ownerId !== actorUserId) {
      throw new ForbiddenError('Only the project owner can manage the join code');
    }
    if (project.joinCode) {
      return project.joinCode;
    }
    return this.assignFreshJoinCode(projectId);
  }

  /**
   * Replaces the join code, which immediately invalidates the old one. The
   * way to revoke a code that was shared too widely.
   */
  async rotateJoinCode(projectId: string, actorUserId: string): Promise<string> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }
    if (project.ownerId !== actorUserId) {
      throw new ForbiddenError('Only the project owner can manage the join code');
    }
    return this.assignFreshJoinCode(projectId);
  }

  /**
   * Writes a new unique code, retrying on the (vanishingly unlikely) unique
   * collision rather than trusting a single draw.
   */
  private async assignFreshJoinCode(projectId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateJoinCode();
      try {
        const updated = await prisma.project.update({
          where: { id: projectId },
          data: { joinCode: candidate },
        });
        return updated.joinCode as string;
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === 'P2002') {
          continue;
        }
        throw err;
      }
    }
    throw new Error('Could not allocate a unique join code');
  }

  /**
   * Redeems a join code: the caller becomes a MEMBER of that project.
   *
   * Requires a real authenticated user (enforced by requireAuth on the route),
   * and grants only MEMBER, never OWNER. Already being a member is a success,
   * not an error, so a shared link is safe to click twice.
   */
  async joinByCode(code: string, actorUserId: string): Promise<Project> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestError('A join code is required');
    }

    const project = await prisma.project.findUnique({
      where: { joinCode: normalized },
    });

    // Deliberately the same message for "no such code" as for a malformed
    // one: a probing client should not be able to tell the difference.
    if (!project) {
      throw new NotFoundError('That join code does not match any workspace');
    }

    if (project.ownerId === actorUserId) {
      return withoutJoinCode(project) as Project;
    }

    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: actorUserId } },
    });

    if (!existing) {
      await prisma.projectMember.create({
        data: {
          projectId: project.id,
          userId: actorUserId,
          role: ProjectRole.MEMBER,
        },
      });
    }

    return withoutJoinCode(project) as Project;
  }
}

export const projectService = new ProjectService();
