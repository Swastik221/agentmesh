import type { Request } from 'express';

export interface AuthUser {
  id: string;
  walletAddress: string | null;
  displayName: string | null;
}

export interface AuthContext {
  userId: string;
  walletAddress: string | null;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}
