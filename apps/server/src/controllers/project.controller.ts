import { Response, NextFunction } from 'express';

import { projectService } from '../services/project.service.js';
import { createProjectSchema, updateProjectSchema } from '../schemas/project.schema.js';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { UnauthorizedError } from '../errors/app-error.js';

export const listProjects = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const projects = await projectService.getUserProjects(userId);
    res.status(200).json({ projects });
  } catch (error) {
    next(error);
  }
};

export const createProject = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const input = createProjectSchema.parse({
      ...req.body,
      ownerId: userId,
    });
    const project = await projectService.createProject(input);
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
};

export const getProjectById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    const project = await projectService.getProjectById(projectId, userId);
    res.status(200).json(project);
  } catch (error) {
    next(error);
  }
};

export const updateProject = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    const input = updateProjectSchema.parse(req.body);
    const project = await projectService.updateProject(projectId, userId, input);
    res.status(200).json(project);
  } catch (error) {
    next(error);
  }
};

export const deleteProject = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    const result = await projectService.deleteProject(projectId, userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /projects/:projectId/join-code
 * Owner only. Mints the code on first read.
 */
export const getJoinCode = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();
    const projectId = req.params.projectId as string;
    const joinCode = await projectService.getOrCreateJoinCode(projectId, userId);
    res.status(200).json({ joinCode });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /projects/:projectId/join-code/rotate
 * Owner only. Invalidates the previous code.
 */
export const rotateJoinCode = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();
    const projectId = req.params.projectId as string;
    const joinCode = await projectService.rotateJoinCode(projectId, userId);
    res.status(200).json({ joinCode });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /projects/join
 * Any authenticated user redeeming a code they were given. Grants MEMBER.
 */
export const joinProjectByCode = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    const project = await projectService.joinByCode(code, userId);
    res.status(200).json({ project });
  } catch (error) {
    next(error);
  }
};
