import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { worktreeService } from './worktree.service.js';
import { UnauthorizedError } from '../errors/app-error.js';
import { GitWorktreeStatus } from '@agentmesh/shared';

export const createWorktree = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const executionId = req.params.executionId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const worktree = await worktreeService.createWorktree(projectId, executionId, userId);
    res.status(201).json({
      id: worktree.id,
      workspaceId: worktree.workspaceId,
      executionId: worktree.executionId,
      agentId: worktree.agentId,
      taskId: worktree.taskId,
      path: worktree.path,
      branchName: worktree.branchName,
      status: worktree.status,
      createdAt: worktree.createdAt.toISOString(),
      updatedAt: worktree.updatedAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

export const getWorktree = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const executionId = req.params.executionId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const worktree = await worktreeService.getWorktree(projectId, executionId, userId);
    res.status(200).json({
      id: worktree.id,
      workspaceId: worktree.workspaceId,
      executionId: worktree.executionId,
      agentId: worktree.agentId,
      taskId: worktree.taskId,
      path: worktree.path,
      branchName: worktree.branchName,
      status: worktree.status,
      createdAt: worktree.createdAt.toISOString(),
      updatedAt: worktree.updatedAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

export const listWorktrees = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const query = {
      agentId: req.query.agentId as string | undefined,
      taskId: req.query.taskId as string | undefined,
      executionId: req.query.executionId as string | undefined,
      status: req.query.status as GitWorktreeStatus | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    };

    const result = await worktreeService.listWorktrees(projectId, userId, query);
    res.status(200).json({
      items: result.items.map((w) => ({
        id: w.id,
        workspaceId: w.workspaceId,
        executionId: w.executionId,
        agentId: w.agentId,
        taskId: w.taskId,
        path: w.path,
        branchName: w.branchName,
        status: w.status,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
      })),
      page: result.page,
      limit: result.limit,
      total: result.total,
    });
  } catch (error) {
    next(error);
  }
};

export const removeWorktree = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const worktreeId = req.params.worktreeId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const worktree = await worktreeService.removeWorktree(projectId, worktreeId, userId);
    res.status(200).json({
      id: worktree.id,
      workspaceId: worktree.workspaceId,
      executionId: worktree.executionId,
      agentId: worktree.agentId,
      taskId: worktree.taskId,
      path: worktree.path,
      branchName: worktree.branchName,
      status: worktree.status,
      createdAt: worktree.createdAt.toISOString(),
      updatedAt: worktree.updatedAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
};
