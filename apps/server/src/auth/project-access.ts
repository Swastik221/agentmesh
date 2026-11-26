import { Prisma, ProjectRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../errors/app-error.js';

type Db = Prisma.TransactionClient | typeof prisma;

/** Roles allowed to manage a project: its members, policies and settings. */
export const PROJECT_MANAGER_ROLES: readonly ProjectRole[] = [ProjectRole.OWNER, ProjectRole.ADMIN];

/**
 * Resolves a user's effective role in a project, or throws.
 *
 * The project's creator (`ownerId`) always counts as OWNER, so editing their
 * membership row cannot lock them out of their own project.
 *
 * @throws NotFoundError if the project does not exist.
 * @throws ForbiddenError if the user is not a member.
 */
export async function getProjectRole(
  projectId: string,
  userId: string,
  db: Db = prisma,
): Promise<ProjectRole> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });
  if (!project) {
    throw new NotFoundError(`Project with ID '${projectId}' not found`);
  }
  if (project.ownerId === userId) {
    return ProjectRole.OWNER;
  }
  const membership = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  if (!membership) {
    throw new ForbiddenError('User is not a member of this project');
  }
  return membership.role;
}

/**
 * Like `getProjectRole`, but also throws ForbiddenError unless the role is one
 * of `allowed`.
 */
export async function requireProjectRole(
  projectId: string,
  userId: string,
  allowed: readonly ProjectRole[],
  db: Db = prisma,
): Promise<ProjectRole> {
  const role = await getProjectRole(projectId, userId, db);
  if (!allowed.includes(role)) {
    throw new ForbiddenError(`This action requires one of these project roles: ${allowed.join(', ')}`);
  }
  return role;
}
