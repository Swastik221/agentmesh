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
        tags: data.tags || [],
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

    if (query.tag) {
      where.tags = {
        has: query.tag,
      };
    }

    if (query.search) {
      const searchTerm = query.search.trim();
      if (searchTerm.length > 0) {
        where.OR = [
          { title: { contains: searchTerm, mode: 'insensitive' } },
          { content: { contains: searchTerm, mode: 'insensitive' } },
        ];
      }
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

    const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

    return {
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
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

    return await prisma.projectBrainEntry.update({
      where: { id: entryId },
      data: {
        ...(data.type && { type: data.type }),
        ...(data.title && { title: data.title }),
        ...(data.content && { content: data.content }),
        ...(data.tags && { tags: data.tags }),
      },
      include: {
        author: {
          select: authorSelect,
        },
      },
    });
  }

  async deleteEntry(projectId: string, entryId: string, userId: string) {
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

    return { message: 'Project Brain entry deleted successfully' };
  }

  async getProjectBrain(projectId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const entries = await prisma.projectBrainEntry.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: authorSelect,
        },
      },
    });

    const stats = {
      total: entries.length,
      requirements: entries.filter((e) => e.type === 'REQUIREMENT').length,
      decisions: entries.filter((e) => e.type === 'DECISION').length,
      notes: entries.filter((e) => e.type === 'NOTE').length,
      constraints: entries.filter((e) => e.type === 'CONSTRAINT').length,
    };

    return {
      projectId,
      entries,
      stats,
    };
  }
}

export const projectBrainService = new ProjectBrainService();
