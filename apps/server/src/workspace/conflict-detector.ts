import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { FileConflictError } from '../errors/app-error.js';

type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface TaskConflictDetail {
  taskId: string;
  filePaths: string[];
}

export async function detectFileConflicts(
  projectId: string,
  candidateTaskId: string | undefined,
  candidateFilePaths: string[],
  client: PrismaTransactionClient | PrismaClient = prisma,
): Promise<TaskConflictDetail[]> {
  if (!candidateFilePaths || candidateFilePaths.length === 0) {
    return [];
  }

  const candidateSet = new Set(candidateFilePaths);

  const activeTasks = await client.task.findMany({
    where: {
      projectId,
      status: 'IN_PROGRESS',
      ...(candidateTaskId ? { id: { not: candidateTaskId } } : {}),
    },
    select: {
      id: true,
      filePaths: true,
    },
  });

  const conflicts: TaskConflictDetail[] = [];

  for (const task of activeTasks) {
    const overlapping = task.filePaths.filter((p) => candidateSet.has(p));
    if (overlapping.length > 0) {
      conflicts.push({
        taskId: task.id,
        filePaths: overlapping,
      });
    }
  }

  return conflicts;
}

export async function assertNoFileConflicts(
  projectId: string,
  candidateTaskId: string | undefined,
  candidateFilePaths: string[],
  client: PrismaTransactionClient | PrismaClient = prisma,
): Promise<void> {
  const conflicts = await detectFileConflicts(projectId, candidateTaskId, candidateFilePaths, client);
  if (conflicts.length > 0) {
    throw new FileConflictError(conflicts);
  }
}
