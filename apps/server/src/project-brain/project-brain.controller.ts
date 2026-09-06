import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { projectBrainService } from './project-brain.service.js';
import {
  createProjectBrainEntrySchema,
  updateProjectBrainEntrySchema,
  listProjectBrainEntriesQuerySchema,
} from './project-brain.schemas.js';

export const createEntry = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const input = createProjectBrainEntrySchema.parse(req.body);
    const entry = await projectBrainService.createEntry(projectId, req.auth!.userId, input);
    res.status(201).json(entry);
  } catch (error) {
    next(error);
  }
};

export const listEntries = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const query = listProjectBrainEntriesQuerySchema.parse(req.query);
    const result = await projectBrainService.listEntries(projectId, req.auth!.userId, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getEntry = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const entryId = req.params.entryId as string;
    const entry = await projectBrainService.getEntry(projectId, entryId, req.auth!.userId);
    res.status(200).json(entry);
  } catch (error) {
    next(error);
  }
};

export const updateEntry = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const entryId = req.params.entryId as string;
    const input = updateProjectBrainEntrySchema.parse(req.body);
    const entry = await projectBrainService.updateEntry(
      projectId,
      entryId,
      req.auth!.userId,
      input,
    );
    res.status(200).json(entry);
  } catch (error) {
    next(error);
  }
};

export const deleteEntry = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const entryId = req.params.entryId as string;
    await projectBrainService.deleteEntry(projectId, entryId, req.auth!.userId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
