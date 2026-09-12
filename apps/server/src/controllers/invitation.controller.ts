import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { invitationService } from '../services/invitation.service.js';
import { createInvitationSchema } from '../schemas/invitation.schema.js';
import { UnauthorizedError } from '../errors/app-error.js';

export const createInvitation = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    const input = createInvitationSchema.parse(req.body);
    const invitation = await invitationService.createInvitation(projectId, userId, input);
    res.status(201).json(invitation);
  } catch (error) {
    next(error);
  }
};

export const listPendingInvitations = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const invitations = await invitationService.listPendingInvitationsForUser(userId);
    res.status(200).json({ invitations });
  } catch (error) {
    next(error);
  }
};

export const listProjectInvitations = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    const invitations = await invitationService.listProjectInvitations(projectId, userId);
    res.status(200).json({ invitations });
  } catch (error) {
    next(error);
  }
};

export const acceptInvitation = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const invitationId = req.params.invitationId as string;
    const updated = await invitationService.acceptInvitation(invitationId, userId);
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

export const declineInvitation = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const invitationId = req.params.invitationId as string;
    const updated = await invitationService.declineInvitation(invitationId, userId);
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};
