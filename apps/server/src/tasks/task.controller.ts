import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { taskService } from './task.service.js';
import { taskOfferService } from '../services/task-offer.service.js';
import { BadRequestError, UnauthorizedError } from '../errors/app-error.js';
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

/**
 * Post a task to the shared board without naming an agent. Every agent is told
 * it is open; if none claims it in time the coordinator places it.
 */
export const createTaskOffer = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError('Authentication required');

    const projectId = req.params.projectId as string;
    const body = req.body ?? {};
    const task = await taskOfferService.createOffer(projectId, userId, {
      title: typeof body.title === 'string' ? body.title : '',
      description: typeof body.description === 'string' ? body.description : undefined,
      offerSeconds: typeof body.offerSeconds === 'number' ? body.offerSeconds : undefined,
      requiredCapabilities: Array.isArray(body.requiredCapabilities)
        ? body.requiredCapabilities.filter((c: unknown): c is string => typeof c === 'string')
        : undefined,
    });

    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
};

/**
 * Take an open offer for one agent. Used by the board's "give it to this
 * agent" control and by an agent claiming for itself over the CLI.
 */
export const claimTaskOffer = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError('Authentication required');

    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId : '';
    if (!agentId) throw new BadRequestError('agentId is required');

    // A human claiming on an agent's behalf must be a member of the project;
    // the agent's own membership is checked inside the service.
    await taskService.verifyMembership(projectId, userId);

    const responsibility = await taskOfferService.claimOffer(projectId, taskId, agentId);
    res.status(201).json(responsibility);
  } catch (error) {
    next(error);
  }
};

/** Which agents could take an offer right now, and which are busy. */
export const listOfferCandidates = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError('Authentication required');

    const projectId = req.params.projectId as string;
    res.status(200).json(await taskOfferService.listAvailableAgents(projectId, userId));
  } catch (error) {
    next(error);
  }
};
