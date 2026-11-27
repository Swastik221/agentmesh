import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import { UnauthorizedError } from '../errors/app-error.js';

/**
 * Login sessions.
 *
 * The cookie carries a 256-bit random token. Only its SHA-256 hash is stored,
 * the same scheme as agent connect tokens, so reading the database (a backup,
 * a log of rows) does not yield anything that can be replayed as a login.
 *
 * `createSession` returns the row with `id` set to the plaintext token,
 * because that is what callers put in the cookie. The row's real primary key
 * is internal and never sent to a client.
 */

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export class SessionService {
  async createSession(userId: string) {
    const expiresAt = new Date(Date.now() + config.sessionMaxAgeMs);
    const token = crypto.randomBytes(32).toString('base64url');

    const row = await prisma.authSession.create({
      data: {
        userId,
        expiresAt,
        tokenHash: hashSessionToken(token),
      },
    });
    return { ...row, id: token };
  }

  async validateSession(token: string) {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedError('Session invalid or expired');
    }
    const session = await prisma.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: {
        user: true,
      },
    });

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await prisma.authSession.delete({ where: { id: session.id } }).catch(() => {});
      }
      throw new UnauthorizedError('Session invalid or expired');
    }

    return session;
  }

  async invalidateSession(token: string): Promise<void> {
    if (!token) return;
    await prisma.authSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }

  /** Ends every session a user has, everywhere. */
  async invalidateAllForUser(userId: string): Promise<number> {
    const result = await prisma.authSession.deleteMany({ where: { userId } });
    return result.count;
  }

  /**
   * Deletes rows that can no longer authenticate anything: expired sessions,
   * pre-hashing sessions, expired SIWE nonces and expired agent tokens.
   */
  async purgeExpired(): Promise<{ sessions: number; nonces: number; tokens: number }> {
    const now = new Date();
    const [sessions, nonces, tokens] = await Promise.all([
      prisma.authSession.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { tokenHash: null }] } }),
      prisma.siweNonce.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.agentConnectToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);
    return { sessions: sessions.count, nonces: nonces.count, tokens: tokens.count };
  }
}

export const sessionService = new SessionService();
