import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/app-error.js';

/**
 * Agent connect tokens.
 *
 * A BYOA agent runs as a separate process on the developer's machine, so it
 * needs a credential of its own. Handing it the browser's SIWE session would
 * give a local process the user's full API login, which is why the session
 * cookie is httpOnly and unreadable from page JS in the first place.
 *
 * This is the narrower credential instead: it authorises exactly one agent in
 * exactly one project, over the WebSocket only, and it expires. It is never
 * accepted by the REST API and it carries no user login of its own. Minting one
 * still requires a real SIWE session belonging to a project member who owns the
 * agent, so this widens nothing: it only lets that member delegate a single
 * agent connection.
 *
 * The plaintext token is returned once, at mint time, and only the SHA-256 hash
 * is stored, so a database read cannot be replayed against the socket.
 */

/** Ten minutes is enough to paste a command into a terminal, and little else. */
export const CONNECT_TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Lifetime of the resume token handed back on every accepted handshake. It
 * lets a long-running connector (an agent, a shared terminal) reconnect after
 * a network blip or server restart without a fresh token from the UI. It is
 * rotated on every handshake, and the handshake still re-checks agent
 * ownership and project membership, so it never outlives the user's access.
 */
export const RESUME_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const TOKEN_PREFIX = 'amct_';

export interface IssuedConnectToken {
  token: string;
  agentId: string;
  projectId: string;
  expiresAt: Date;
}

export interface ResolvedConnectToken {
  agentId: string;
  projectId: string;
  issuedByUserId: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export class AgentConnectTokenService {
  /**
   * Mints a token for `agentId`. Requires an authenticated user who is a member
   * of the agent's project and owns the agent. Both checks are enforced here,
   * not by the caller.
   */
  async issue(agentId: string, actorUserId: string): Promise<IssuedConnectToken> {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { project: true },
    });

    if (!agent) {
      throw new NotFoundError(`Agent with ID '${agentId}' not found`);
    }

    const isProjectOwner = agent.project.ownerId === actorUserId;
    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: { projectId: agent.projectId, userId: actorUserId },
      },
    });

    if (!membership && !isProjectOwner) {
      throw new ForbiddenError('User is not a member of this project');
    }

    if (agent.ownerId !== actorUserId) {
      throw new ForbiddenError(
        `Agent '${agentId}' is not owned by the authenticated user, so a connect token cannot be issued for it`,
      );
    }

    const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + CONNECT_TOKEN_TTL_MS);

    await prisma.agentConnectToken.create({
      data: {
        tokenHash: hashToken(token),
        agentId: agent.id,
        projectId: agent.projectId,
        issuedByUserId: actorUserId,
        expiresAt,
      },
    });

    return { token, agentId: agent.id, projectId: agent.projectId, expiresAt };
  }

  /**
   * Mints a resume token for a connection that has just completed a
   * handshake. The caller has already verified ownership and membership.
   */
  async issueResume(agentId: string, projectId: string, issuedByUserId: string): Promise<IssuedConnectToken> {
    const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + RESUME_TOKEN_TTL_MS);
    await prisma.agentConnectToken.create({
      data: { tokenHash: hashToken(token), agentId, projectId, issuedByUserId, expiresAt },
    });
    return { token, agentId, projectId, expiresAt };
  }

  /**
   * Resolves a presented token. Throws `UnauthorizedError` for anything that is
   * not a live, unrevoked, unexpired token. Never falls back to session auth.
   */
  async resolve(token: string | undefined | null): Promise<ResolvedConnectToken> {
    if (!token || typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) {
      throw new UnauthorizedError('Invalid agent connect token');
    }

    const record = await prisma.agentConnectToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!record || record.revokedAt !== null || record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('Invalid or expired agent connect token');
    }

    return {
      agentId: record.agentId,
      projectId: record.projectId,
      issuedByUserId: record.issuedByUserId,
    };
  }

  /** Best-effort cleanup of tokens that can no longer authorise anything. */
  async purgeExpired(): Promise<number> {
    const result = await prisma.agentConnectToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}

export const agentConnectTokenService = new AgentConnectTokenService();
