import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../errors/app-error.js';
import {
  CreateProjectBrainEntryInput,
  UpdateProjectBrainEntryInput,
  ListProjectBrainEntriesQuery,
} from './project-brain.schemas.js';

const authorSelect = {
  id: true,
  walletAddress: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
};

export class ProjectBrainService {
  private async verifyProjectMembership(projectId: string, userId: string): Promise<void> {
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

  async createEntry(projectId: string, userId: string, data: CreateProjectBrainEntryInput) {
    await this.verifyProjectMembership(projectId, userId);

    return await prisma.projectBrainEntry.create({
      data: {
        projectId,
        authorId: userId,
        type: data.type,
        title: data.title,
        content: data.content,
        metadata: data.metadata !== undefined && data.metadata !== null
          ? (data.metadata as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      include: {
        author: {
          select: authorSelect,
        },
      },
    });
  }

  async listEntries(projectId: string, userId: string, query: ListProjectBrainEntriesQuery) {
    await this.verifyProjectMembership(projectId, userId);

    const where: Prisma.ProjectBrainEntryWhereInput = {
      projectId,
    };

    if (query.type) {
      where.type = query.type;
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [entries, total] = await prisma.$transaction([
      prisma.projectBrainEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          author: {
            select: authorSelect,
          },
        },
      }),
      prisma.projectBrainEntry.count({ where }),
    ]);

    return {
      items: entries,
      page,
      limit,
      total,
    };
  }

  async getEntry(projectId: string, entryId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const entry = await prisma.projectBrainEntry.findUnique({
      where: { id: entryId },
      include: {
        author: {
          select: authorSelect,
        },
      },
    });

    if (!entry || entry.projectId !== projectId) {
      throw new NotFoundError('Project Brain entry not found');
    }

    return entry;
  }

  async updateEntry(
    projectId: string,
    entryId: string,
    userId: string,
    data: UpdateProjectBrainEntryInput,
  ) {
    await this.verifyProjectMembership(projectId, userId);

    const entry = await prisma.projectBrainEntry.findUnique({
      where: { id: entryId },
    });

    if (!entry || entry.projectId !== projectId) {
      throw new NotFoundError('Project Brain entry not found');
    }

    const updateData: Prisma.ProjectBrainEntryUpdateInput = {};

    if (data.type !== undefined) {
      updateData.type = data.type;
    }

    if (data.title !== undefined) {
      updateData.title = data.title;
    }

    if (data.content !== undefined) {
      updateData.content = data.content;
    }

    if (data.metadata !== undefined) {
      updateData.metadata = data.metadata !== null
        ? (data.metadata as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }

    return await prisma.projectBrainEntry.update({
      where: { id: entryId },
      data: updateData,
      include: {
        author: {
          select: authorSelect,
        },
      },
    });
  }

  async deleteEntry(projectId: string, entryId: string, userId: string): Promise<void> {
    await this.verifyProjectMembership(projectId, userId);

    const entry = await prisma.projectBrainEntry.findUnique({
      where: { id: entryId },
    });

    if (!entry || entry.projectId !== projectId) {
      throw new NotFoundError('Project Brain entry not found');
    }

    await prisma.projectBrainEntry.delete({
      where: { id: entryId },
    });
  }
}

export const projectBrainService = new ProjectBrainService();
