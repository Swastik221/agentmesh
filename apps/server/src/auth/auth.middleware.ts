import { Response, NextFunction } from 'express';
import { sessionService } from './session.service.js';
import { AuthenticatedRequest } from './auth.types.js';
import { UnauthorizedError } from '../errors/app-error.js';

export const extractSessionId = (req: AuthenticatedRequest): string | null => {
  if (req.cookies && req.cookies.agentmesh_session) {
    return req.cookies.agentmesh_session;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return null;
};

export const requireAuth = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      throw new UnauthorizedError('Authentication required');
    }

    const session = await sessionService.validateSession(sessionId);
    req.auth = {
      userId: session.user.id,
      walletAddress: session.user.walletAddress,
      sessionId: session.id,
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuth = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const sessionId = extractSessionId(req);
    if (sessionId) {
      const session = await sessionService.validateSession(sessionId).catch(() => null);
      if (session) {
        req.auth = {
          userId: session.user.id,
          walletAddress: session.user.walletAddress,
          sessionId: session.id,
        };
      }
    }
    next();
  } catch {
    next();
  }
};
