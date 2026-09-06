import { Request, Response, NextFunction } from 'express';

import { projectService } from '../services/project.service.js';
import { createProjectSchema, updateProjectSchema } from '../schemas/project.schema.js';
import { AuthenticatedRequest } from '../auth/auth.types.js';

export const createProject = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = createProjectSchema.parse(req.body);
    const ownerId = req.auth ? req.auth.userId : input.ownerId;
    const project = await projectService.createProject({
      ...input,
      ownerId,
    });
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
};

export const getProjectById = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const project = await projectService.getProjectById(projectId);
    res.status(200).json(project);
  } catch (error) {
    next(error);
  }
};

export const updateProject = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const input = updateProjectSchema.parse(req.body);
    const project = await projectService.updateProject(projectId, input);
    res.status(200).json(project);
  } catch (error) {
    next(error);
  }
};

export const deleteProject = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const result = await projectService.deleteProject(projectId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
