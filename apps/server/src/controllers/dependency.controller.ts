import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { dependencyService } from '../services/dependency.service.js';
import { UnauthorizedError } from '../errors/app-error.js';

export const createDependency = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const dependency = await dependencyService.createDependency(
      projectId,
      taskId,
      userId,
      req.body,
    );

    res.status(201).json(dependency);
  } catch (error) {
    next(error);
  }
};

export const listDependencies = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const dependencies = await dependencyService.listDependencies(
      projectId,
      taskId,
      userId,
    );

    res.status(200).json(dependencies);
  } catch (error) {
    next(error);
  }
};

export const getDependencyReadiness = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const readiness = await dependencyService.resolveTaskDependencies(
      projectId,
      taskId,
      userId,
    );

    res.status(200).json(readiness);
  } catch (error) {
    next(error);
  }
};

export const removeDependency = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const dependencyId = req.params.dependencyId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    await dependencyService.removeDependency(
      projectId,
      taskId,
      dependencyId,
      userId,
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
