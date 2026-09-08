import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../errors/app-error.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { AgentMeshMessageType } from '@agentmesh/agent-protocol';

export interface CreateDependencyInput {
  dependencyType?: string;
  dependsOnTaskId?: string;
  artifactId?: string;
}

export class DependencyService {
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

  /**
   * Bounded DAG cycle detection: Checks if adding an edge (sourceTaskId -> targetTaskId) creates a cycle.
   * Returns isInconclusive=true if depth bound is reached before proving cycle safety.
   */
  private async detectTaskCycle(
    sourceTaskId: string,
    targetTaskId: string,
    maxDepth: number,
  ): Promise<{ hasCycle: boolean; isInconclusive: boolean }> {
    const queue: Array<{ taskId: string; depth: number }> = [
      { taskId: targetTaskId, depth: 1 },
    ];
    const visited = new Set<string>([targetTaskId]);
    let hitDepthLimit = false;

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.taskId === sourceTaskId) {
        return { hasCycle: true, isInconclusive: false }; // Cycle detected!
      }

      if (current.depth >= maxDepth) {
        hitDepthLimit = true;
        continue; // Bound depth traversal
      }

      const nextDeps = await prisma.taskDependency.findMany({
        where: {
          taskId: current.taskId,
          dependsOnTaskId: { not: null },
        },
        select: { dependsOnTaskId: true },
      });

      for (const dep of nextDeps) {
        if (dep.dependsOnTaskId && !visited.has(dep.dependsOnTaskId)) {
          visited.add(dep.dependsOnTaskId);
          queue.push({
            taskId: dep.dependsOnTaskId,
            depth: current.depth + 1,
          });
        }
      }
    }

    return { hasCycle: false, isInconclusive: hitDepthLimit };
  }

  async createDependency(
    projectId: string,
    taskId: string,
    userId: string,
    data: CreateDependencyInput,
  ) {
    await this.verifyProjectMembership(projectId, userId);

    const hasTaskTarget = Boolean(data.dependsOnTaskId && data.dependsOnTaskId.trim());
    const hasArtifactTarget = Boolean(data.artifactId && data.artifactId.trim());

    if (!hasTaskTarget && !hasArtifactTarget) {
      throw new BadRequestError('Dependency must target either a task or an artifact');
    }

    if (hasTaskTarget && hasArtifactTarget) {
      throw new BadRequestError('Dependency cannot target both a task and an artifact simultaneously');
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    let dependsOnTaskId: string | null = null;
    let artifactId: string | null = null;
    let dependencyType = data.dependencyType || 'TASK_COMPLETION';

    if (hasTaskTarget) {
      dependsOnTaskId = data.dependsOnTaskId!.trim();

      if (taskId === dependsOnTaskId) {
        throw new BadRequestError('A task cannot depend on itself');
      }

      const targetTask = await prisma.task.findUnique({
        where: { id: dependsOnTaskId },
      });

      if (!targetTask || targetTask.projectId !== projectId) {
        throw new NotFoundError('Dependent task not found in this project');
      }

      // Perform cycle check
      const cycleCheck = await this.detectTaskCycle(
        taskId,
        dependsOnTaskId,
        config.maxDependencyTraversalDepth,
      );

      if (cycleCheck.hasCycle) {
        throw new BadRequestError('Circular task dependency detected');
      }

      if (cycleCheck.isInconclusive) {
        throw new BadRequestError('DEPENDENCY_GRAPH_TOO_DEEP');
      }

      // Check existing
      const existing = await prisma.taskDependency.findUnique({
        where: {
          taskId_dependsOnTaskId: {
            taskId,
            dependsOnTaskId,
          },
        },
      });

      if (existing) {
        throw new ConflictError('Dependency already exists');
      }
    } else if (hasArtifactTarget) {
      artifactId = data.artifactId!.trim();
      dependencyType = data.dependencyType || 'ARTIFACT_REQUIRED';

      const targetArtifact = await prisma.artifact.findUnique({
        where: { id: artifactId },
      });

      if (!targetArtifact || targetArtifact.projectId !== projectId) {
        throw new NotFoundError('Artifact not found in this project');
      }

      if (targetArtifact.taskId === taskId) {
        throw new BadRequestError('A task cannot depend on an artifact produced by itself');
      }

      // Check existing
      const existing = await prisma.taskDependency.findUnique({
        where: {
          taskId_artifactId: {
            taskId,
            artifactId,
          },
        },
      });

      if (existing) {
        throw new ConflictError('Dependency already exists');
      }
    }

    try {
      const dependency = await prisma.taskDependency.create({
        data: {
          projectId,
          taskId,
          dependsOnTaskId,
          artifactId,
          dependencyType,
        },
        include: {
          dependsOnTask: {
            select: {
              id: true,
              title: true,
              status: true,
            },
          },
          artifact: {
            select: {
              id: true,
              name: true,
              type: true,
              version: true,
            },
          },
        },
      });

      // Post-commit broadcast
      connectionManager.broadcastToProject(projectId, {
        type: AgentMeshMessageType.DEPENDENCY_DECLARED,
        payload: {
          dependencyId: dependency.id,
          projectId,
          taskId,
          dependencyType: dependency.dependencyType,
          dependsOnTaskId: dependency.dependsOnTaskId || undefined,
          artifactId: dependency.artifactId || undefined,
        },
      });

      // Determine initial availability
      let isAvailable = false;
      if (dependency.dependsOnTask) {
        isAvailable = dependency.dependsOnTask.status === 'COMPLETED';
      } else if (dependency.artifact) {
        isAvailable = true;
      }

      if (isAvailable) {
        connectionManager.broadcastToProject(projectId, {
          type: AgentMeshMessageType.DEPENDENCY_AVAILABLE,
          payload: {
            dependencyId: dependency.id,
            projectId,
            taskId,
            dependsOnTaskId: dependency.dependsOnTaskId || undefined,
            artifactId: dependency.artifactId || undefined,
            available: true,
          },
        });
      }

      return dependency;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError('Dependency already exists');
      }
      throw error;
    }
  }

  async listDependencies(projectId: string, taskId: string, userId: string) {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const dependencies = await prisma.taskDependency.findMany({
      where: { taskId },
      include: {
        dependsOnTask: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
          },
        },
        artifact: {
          select: {
            id: true,
            name: true,
            type: true,
            version: true,
            taskId: true,
            agentId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return dependencies.map((dep) => {
      let available = false;
      if (dep.dependsOnTaskId && dep.dependsOnTask) {
        available = dep.dependsOnTask.status === 'COMPLETED';
      } else if (dep.artifactId && dep.artifact) {
        available = true;
      }

      return {
        id: dep.id,
        projectId: dep.projectId,
        taskId: dep.taskId,
        dependencyType: dep.dependencyType,
        dependsOnTaskId: dep.dependsOnTaskId,
        artifactId: dep.artifactId,
        available,
        createdAt: dep.createdAt,
        dependsOnTask: dep.dependsOnTask,
        artifact: dep.artifact,
      };
    });
  }

  async resolveTaskDependencies(projectId: string, taskId: string, userId: string) {
    const items = await this.listDependencies(projectId, taskId, userId);
    const total = items.length;
    const availableCount = items.filter((item) => item.available).length;
    const ready = total === availableCount;

    return {
      ready,
      total,
      available: availableCount,
      items,
    };
  }

  async removeDependency(
    projectId: string,
    taskId: string,
    dependencyId: string,
    userId: string,
  ): Promise<void> {
    await this.verifyProjectMembership(projectId, userId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('Task not found');
    }

    const dependency = await prisma.taskDependency.findFirst({
      where: {
        id: dependencyId,
        taskId,
        projectId,
      },
    });

    if (!dependency) {
      throw new NotFoundError('Dependency not found');
    }

    await prisma.taskDependency.delete({
      where: { id: dependencyId },
    });
  }
}

export const dependencyService = new DependencyService();
