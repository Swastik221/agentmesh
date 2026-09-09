import { Project, ProjectRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateProjectInput, UpdateProjectInput } from '../schemas/project.schema.js';
import { NotFoundError, ForbiddenError } from '../errors/app-error.js';

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

      return project;
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

    return project;
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
      ...m.project,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async updateProject(id: string, actorUserId: string, data: UpdateProjectInput): Promise<Project> {
    await this.verifyProjectMembership(id, actorUserId);

    return await prisma.project.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });
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
}

export const projectService = new ProjectService();
