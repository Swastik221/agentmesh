import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { artifactService } from '../services/artifact.service.js';
import { UnauthorizedError } from '../errors/app-error.js';

export const createArtifact = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const artifact = await artifactService.createArtifact(
      projectId,
      taskId,
      userId,
      req.body,
    );

    res.status(201).json(artifact);
  } catch (error) {
    next(error);
  }
};

export const listArtifacts = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const type = req.query.type as string | undefined;

    const result = await artifactService.listArtifacts(projectId, taskId, userId, {
      page,
      limit,
      type,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getArtifact = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const artifactId = req.params.artifactId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const artifact = await artifactService.getArtifact(projectId, artifactId, userId);

    res.status(200).json(artifact);
  } catch (error) {
    next(error);
  }
};
