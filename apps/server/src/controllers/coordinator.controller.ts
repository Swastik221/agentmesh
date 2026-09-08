import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { coordinatorService } from '../services/coordinator.service.js';
import { coordinatorAssignSchema } from '../tasks/task.schemas.js';

export async function assignTask(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const projectId = req.params.projectId as string;
    const taskId = req.params.taskId as string;
    const parsedBody = coordinatorAssignSchema.parse(req.body || {});

    const result = await coordinatorService.assignTask(
      projectId,
      taskId,
      req.auth!.userId,
      parsedBody.preferredAgentId ? { preferredAgentId: parsedBody.preferredAgentId } : undefined,
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
