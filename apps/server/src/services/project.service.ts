import { Project, ProjectRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateProjectInput, UpdateProjectInput } from '../schemas/project.schema.js';
import { NotFoundError } from '../errors/app-error.js';

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

  async getProjectById(id: string) {
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

  async updateProject(id: string, data: UpdateProjectInput): Promise<Project> {
    await this.getProjectById(id);

    return await prisma.project.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });
  }

  async deleteProject(id: string): Promise<{ message: string }> {
    await this.getProjectById(id);

    await prisma.project.delete({
      where: { id },
    });

    return { message: 'Project deleted successfully' };
  }
}

export const projectService = new ProjectService();
