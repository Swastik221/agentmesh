import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { activityService } from '../services/activity.service.js';
import { UnauthorizedError } from '../errors/app-error.js';

export const listActivity = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.auth?.userId;
    if (!userId) throw new UnauthorizedError();

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const events = await activityService.listActivity(projectId, userId, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    res.status(200).json({ events });
  } catch (error) {
    next(error);
  }
};