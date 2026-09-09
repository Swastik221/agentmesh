import { Response, NextFunction } from 'express';
import { memberService } from '../services/member.service.js';
import { addMemberSchema, updateMemberRoleSchema } from '../schemas/member.schema.js';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { UnauthorizedError } from '../errors/app-error.js';

export const addMember = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    const input = addMemberSchema.parse(req.body);
    const member = await memberService.addMember(projectId, actorUserId, input);
    res.status(201).json(member);
  } catch (error) {
    next(error);
  }
};

export const getProjectMembers = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    const members = await memberService.getProjectMembers(projectId, actorUserId);
    res.status(200).json(members);
  } catch (error) {
    next(error);
  }
};

export const updateMemberRole = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    const userId = req.params.userId as string;
    const input = updateMemberRoleSchema.parse(req.body);
    const member = await memberService.updateMemberRole(projectId, userId, actorUserId, input);
    res.status(200).json(member);
  } catch (error) {
    next(error);
  }
};

export const removeMember = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    const userId = req.params.userId as string;
    const result = await memberService.removeMember(projectId, userId, actorUserId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
