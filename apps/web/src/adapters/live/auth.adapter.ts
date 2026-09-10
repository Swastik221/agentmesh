import { AuthAdapter, User } from '../types';
import { authSessionService } from '../../services/auth-session';

export class LiveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveAuthError';
  }
}

export const liveAuthAdapter: AuthAdapter = {
  async login(_credentials: { email: string; password?: string; remember?: boolean }): Promise<User> {
    const session = await authSessionService.fetchSession();
    if (session.authenticated && session.user) {
      return session.user;
    }
    throw new LiveAuthError('No active SIWE authentication session found. Please connect your wallet and complete SIWE authentication.');
  },

  async signup(_details: { displayName: string; email: string; password?: string }): Promise<User> {
    throw new LiveAuthError('Email/password signup is not supported in Live Mode. AgentMesh uses SIWE (Sign-In with Ethereum) wallet authentication.');
  },

  async logout(): Promise<void> {
    await authSessionService.logout();
  },

  getCurrentUser(): User | null {
    return authSessionService.getCurrentUser();
  },
};
