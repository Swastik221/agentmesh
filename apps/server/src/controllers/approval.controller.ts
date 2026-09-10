import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { UnauthorizedError } from '../errors/app-error.js';
import { approvalService } from '../services/approval.service.js';
import {
  createApprovalRequestSchema,
  resolveApprovalSchema,
  listApprovalsQuerySchema,
} from '../schemas/approval.schema.js';

export const createApproval = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const input = createApprovalRequestSchema.parse(req.body);
    const approval = await approvalService.createApprovalRequest(
      input.projectId,
      actorUserId,
      input,
    );
    res.status(201).json(approval);
  } catch (error) {
    next(error);
  }
};

export const listApprovals = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const query = listApprovalsQuerySchema.parse(req.query);
    const result = await approvalService.listApprovalRequests(actorUserId, query);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getApprovalById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const approvalId = req.params.approvalId as string;
    const approval = await approvalService.getApprovalRequest(approvalId, actorUserId);
    res.json(approval);
  } catch (error) {
    next(error);
  }
};

export const approveApproval = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const approvalId = req.params.approvalId as string;
    const input = resolveApprovalSchema.parse(req.body || {});

    const approval = await approvalService.approveRequest(
      approvalId,
      actorUserId,
      input.reason || undefined,
    );
    res.json(approval);
  } catch (error) {
    next(error);
  }
};

export const rejectApproval = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const approvalId = req.params.approvalId as string;
    const input = resolveApprovalSchema.parse(req.body || {});

    const approval = await approvalService.rejectRequest(
      approvalId,
      actorUserId,
      input.reason || undefined,
    );
    res.json(approval);
  } catch (error) {
    next(error);
  }
};
