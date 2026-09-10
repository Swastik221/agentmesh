import type { AuthAdapter, User } from '../types';

const SESSION_KEY = 'agentmesh.adapter.session.v1';

export const DEMO_USERS: Record<string, User> = {
  anand: {
    id: 'user-anand',
    email: 'anand@agentmesh.demo',
    displayName: 'Anand',
    createdAt: '2026-09-08T00:00:00Z',
  },
  swastik: {
    id: 'user-swastik',
    email: 'swastik@agentmesh.demo',
    displayName: 'Swastik',
    createdAt: '2026-09-08T00:00:00Z',
  },
};

export class DemoAuthAdapter implements AuthAdapter {
  async login(credentials: { email: string; password?: string; remember?: boolean }): Promise<User> {
    await new Promise((resolve) => setTimeout(resolve, 180));
    const normalized = credentials.email.toLowerCase().trim();
    let user: User;
    if (normalized.includes('swastik')) {
      user = DEMO_USERS.swastik;
    } else {
      user = {
        id: `user-${Date.now()}`,
        email: normalized || DEMO_USERS.anand.email,
        displayName: normalized.split('@')[0] || 'Anand',
        createdAt: new Date().toISOString(),
      };
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    if (credentials.remember) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    }
    return user;
  }

  async signup(details: { displayName: string; email: string; password?: string }): Promise<User> {
    await new Promise((resolve) => setTimeout(resolve, 220));
    const user: User = {
      id: `user-${Date.now()}`,
      email: details.email.toLowerCase().trim(),
      displayName: details.displayName.trim() || 'Developer',
      createdAt: new Date().toISOString(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return user;
  }

  async logout(): Promise<void> {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  getCurrentUser(): User | null {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
      return stored ? (JSON.parse(stored) as User) : DEMO_USERS.anand;
    } catch {
      return DEMO_USERS.anand;
    }
  }
}
