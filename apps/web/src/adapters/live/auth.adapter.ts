import { AuthAdapter, User } from '../types';
import { authSessionService } from '../../services/auth-session';

export const liveAuthAdapter: AuthAdapter = {
  async login(credentials: { email: string; password?: string; remember?: boolean }): Promise<User> {
    // Session login check or fallback user lookup
    const session = await authSessionService.fetchSession();
    if (session.user) {
      return session.user;
    }

    return {
      id: 'usr_live_' + Date.now(),
      email: credentials.email,
      displayName: credentials.email.split('@')[0] || 'Live Developer',
      createdAt: new Date().toISOString(),
    };
  },

  async signup(details: { displayName: string; email: string; password?: string }): Promise<User> {
    return {
      id: 'usr_live_' + Date.now(),
      email: details.email,
      displayName: details.displayName,
      createdAt: new Date().toISOString(),
    };
  },

  async logout(): Promise<void> {
    await authSessionService.logout();
  },

  getCurrentUser(): User | null {
    return authSessionService.getCurrentUser();
  },
};
