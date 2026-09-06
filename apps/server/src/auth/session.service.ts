import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import { UnauthorizedError } from '../errors/app-error.js';

export class SessionService {
  async createSession(userId: string) {
    const expiresAt = new Date(Date.now() + config.sessionMaxAgeMs);

    return prisma.authSession.create({
      data: {
        userId,
        expiresAt,
      },
    });
  }

  async validateSession(sessionId: string) {
    const session = await prisma.authSession.findUnique({
      where: { id: sessionId },
      include: {
        user: true,
      },
    });

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await prisma.authSession.delete({ where: { id: sessionId } }).catch(() => {});
      }
      throw new UnauthorizedError('Session invalid or expired');
    }

    return session;
  }

  async invalidateSession(sessionId: string): Promise<void> {
    await prisma.authSession.delete({ where: { id: sessionId } }).catch(() => {});
  }
}

export const sessionService = new SessionService();
