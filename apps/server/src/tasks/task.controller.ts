import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { taskService } from './task.service.js';
import {
  createTaskSchema,
  updateTaskSchema,
  listTasksQuerySchema,
  assignResponsibilitySchema,
  createDependencySchema,
} from './task.schemas.js';

export const createTask = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const input = createTaskSchema.parse(req.body);
    const task = await taskService.createTask(projectId, req.auth!.userId, input);
    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
};

export const listTasks = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const query = listTasksQuerySchema.parse(req.query);
    const result = await taskService.listTasks(projectId, req.auth!.userId, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getTask = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const task = await taskService.getTask(projectId, taskId, req.auth!.userId);
    res.status(200).json(task);
  } catch (error) {
    next(error);
  }
};

export const updateTask = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const input = updateTaskSchema.parse(req.body);
    const task = await taskService.updateTask(projectId, taskId, req.auth!.userId, input);
    res.status(200).json(task);
  } catch (error) {
    next(error);
  }
};

export const deleteTask = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    await taskService.deleteTask(projectId, taskId, req.auth!.userId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// Responsibilities
export const assignResponsibility = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const input = assignResponsibilitySchema.parse(req.body);
    const responsibility = await taskService.assignResponsibility(
      projectId,
      taskId,
      req.auth!.userId,
      input,
    );
    res.status(201).json(responsibility);
  } catch (error) {
    next(error);
  }
};

export const listResponsibilities = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const result = await taskService.listResponsibilities(projectId, taskId, req.auth!.userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const removeResponsibility = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const agentId = req.params.agentId as string;
    await taskService.removeResponsibility(projectId, taskId, agentId, req.auth!.userId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// Dependencies
export const addDependency = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const input = createDependencySchema.parse(req.body);
    const dependency = await taskService.addDependency(
      projectId,
      taskId,
      req.auth!.userId,
      input,
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
    const result = await taskService.listDependencies(projectId, taskId, req.auth!.userId);
    res.status(200).json(result);
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
    const dependsOnTaskId = req.params.dependsOnTaskId as string;
    await taskService.removeDependency(
      projectId,
      taskId,
      dependsOnTaskId,
      req.auth!.userId,
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
