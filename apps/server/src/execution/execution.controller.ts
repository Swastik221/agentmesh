import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { executionService } from './execution.service.js';
import {
  createTaskExecutionSchema,
  listExecutionsQuerySchema,
} from './execution.schemas.js';

export const createExecution = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const input = createTaskExecutionSchema.parse(req.body);
    const execution = await executionService.createExecution(
      projectId,
      taskId,
      req.auth!.userId,
      input,
    );
    res.status(201).json(execution);
  } catch (error) {
    next(error);
  }
};

export const listExecutions = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const query = listExecutionsQuerySchema.parse(req.query);
    const result = await executionService.listExecutions(
      projectId,
      taskId,
      req.auth!.userId,
      query,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getExecution = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const executionId = req.params.executionId as string;
    const execution = await executionService.getExecution(
      projectId,
      taskId,
      executionId,
      req.auth!.userId,
    );
    res.status(200).json(execution);
  } catch (error) {
    next(error);
  }
};

export const cancelExecution = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const executionId = req.params.executionId as string;
    const execution = await executionService.cancelExecution(
      projectId,
      taskId,
      executionId,
      req.auth!.userId,
    );
    res.status(200).json(execution);
  } catch (error) {
    next(error);
  }
};

