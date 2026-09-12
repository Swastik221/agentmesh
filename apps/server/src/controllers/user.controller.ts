import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { userService } from '../services/user.service.js';
import { projectService } from '../services/project.service.js';
import { createUserSchema, updateUserSchema } from '../schemas/user.schema.js';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';

export const createUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authUserId = req.auth?.userId;
    const authWalletAddress = req.auth?.walletAddress;
    if (!authUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const input = createUserSchema.parse(req.body);

    if (
      input.walletAddress &&
      authWalletAddress &&
      input.walletAddress.toLowerCase() !== authWalletAddress.toLowerCase()
    ) {
      throw new ForbiddenError('Cannot create user for another wallet address');
    }

    const user = await userService.createUser({
      walletAddress: authWalletAddress || input.walletAddress,
      displayName: input.displayName,
    });
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
};

export const getUserById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authUserId = req.auth?.userId;
    if (!authUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const targetUserId = req.params.userId as string;
    const user = await userService.getUserById(targetUserId);

    const isAuthorized = await userService.areUsersInSameProject(authUserId, targetUserId);
    if (!isAuthorized) {
      throw new ForbiddenError('Access to this user profile is forbidden');
    }

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

export const getUserByWallet = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authUserId = req.auth?.userId;
    const authWalletAddress = req.auth?.walletAddress;
    if (!authUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const targetWallet = req.params.walletAddress as string;
    const user = await userService.getUserByWallet(targetWallet);

    const isSameWallet =
      authWalletAddress && authWalletAddress.toLowerCase() === targetWallet.toLowerCase();
    const isSharedProjectMember = await userService.areUsersInSameProject(authUserId, user.id);

    if (!isSameWallet && !isSharedProjectMember) {
      throw new ForbiddenError('Access to this user wallet profile is forbidden');
    }

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authUserId = req.auth?.userId;
    if (!authUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const targetUserId = req.params.userId as string;
    if (authUserId !== targetUserId) {
      throw new ForbiddenError('Cannot update another user profile');
    }

    const input = updateUserSchema.parse(req.body);
    const user = await userService.updateUser(authUserId, input);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

export const getUserProjects = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authUserId = req.auth?.userId;
    if (!authUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const targetUserId = req.params.userId as string;
    // Verify target user exists first (throws 404 if non-existent)
    await userService.getUserById(targetUserId);

    if (authUserId !== targetUserId) {
      throw new ForbiddenError("Cannot view another user's project list");
    }

    const projects = await projectService.getUserProjects(authUserId);
    res.status(200).json(projects);
  } catch (error) {
    next(error);
  }
};
