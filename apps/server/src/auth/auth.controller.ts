import { Response, NextFunction } from 'express';
import { authService } from './auth.service.js';
import { verifySiweSchema } from './auth.schemas.js';
import { AuthenticatedRequest } from './auth.types.js';
import { extractSessionId } from './auth.middleware.js';

import { config } from '../config/index.js';
import { prisma } from '../lib/prisma.js';
import { UnauthorizedError } from '../errors/app-error.js';

export const getNonce = async (
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await authService.getNonce();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const verify = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = verifySiweSchema.parse(req.body);
    const { user, sessionId } = await authService.verifyAndLogin(input);

    res.cookie('agentmesh_session', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: config.sessionMaxAgeMs,
    });

    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.auth) {
      throw new UnauthorizedError('Unauthorized');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    res.status(200).json({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        displayName: user.displayName,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const sessionId = extractSessionId(req);
    if (sessionId) {
      await authService.logout(sessionId);
    }

    res.clearCookie('agentmesh_session');
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
