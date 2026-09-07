import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { workspaceService } from './workspace.service.js';
import { UnauthorizedError } from '../errors/app-error.js';

export const createWorkspace = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const workspace = await workspaceService.createWorkspace(projectId, userId);
    res.status(201).json({
      id: workspace.id,
      projectId: workspace.projectId,
      rootPath: workspace.rootPath,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

export const getWorkspace = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const workspace = await workspaceService.getWorkspace(projectId, userId);
    res.status(200).json({
      id: workspace.id,
      projectId: workspace.projectId,
      rootPath: workspace.rootPath,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

export const getWorkspaceState = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const state = await workspaceService.getWorkspaceState(projectId, userId);
    res.status(200).json(state);
  } catch (error) {
    next(error);
  }
};

