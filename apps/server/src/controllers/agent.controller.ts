import { Response, NextFunction } from 'express';
import { agentService } from '../services/agent.service.js';
import { createAgentSchema, updateAgentSchema } from '../schemas/agent.schema.js';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { UnauthorizedError } from '../errors/app-error.js';
import { agentConnectTokenService } from '../services/agent-connect-token.service.js';

export const createAgent = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    // ownerId is ALWAYS derived from the authenticated session.
    // Spread req.body first so any client-supplied ownerId, ensAddress, or
    // ensVerifiedAt is silently overwritten by the server-controlled values.
    const input = createAgentSchema.parse({
      ...req.body,
      ownerId: actorUserId, // server-derived; must come last to override any client value
    });
    const agent = await agentService.createAgent(
      projectId,
      actorUserId,
      input,
      req.auth?.walletAddress,
    );
    res.status(201).json(agent);
  } catch (error) {
    next(error);
  }
};

export const listProjectAgents = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }
    const projectId = req.params.projectId as string;
    const capability = req.query.capability as string | undefined;
    const agents = await agentService.listProjectAgents(projectId, actorUserId, capability);
    res.status(200).json(agents);
  } catch (error) {
    next(error);
  }
};

export const getAgent = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }
    const agentId = req.params.agentId as string;
    const agent = await agentService.getAgent(agentId, actorUserId);
    res.status(200).json(agent);
  } catch (error) {
    next(error);
  }
};

export const updateAgent = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }
    const agentId = req.params.agentId as string;
    const input = updateAgentSchema.parse(req.body);
    const agent = await agentService.updateAgent(
      agentId,
      actorUserId,
      input,
      req.auth?.walletAddress,
    );
    res.status(200).json(agent);
  } catch (error) {
    next(error);
  }
};

export const deleteAgent = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }
    const agentId = req.params.agentId as string;
    await agentService.deleteAgent(agentId, actorUserId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * GET /agents/:agentId/identity
 * Returns the ENS identity fields for an agent.
 * Requires auth + project membership (enforced via agentService.getAgent).
 */
export const getAgentIdentity = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError('Authentication required');
    }
    const agentId = req.params.agentId as string;
    const agent = await agentService.getAgent(agentId, actorUserId);

    res.status(200).json({
      agentId: agent.id,
      ensName: agent.ensName ?? null,
      ensAddress: agent.ensAddress ?? null,
      verified: agent.ensVerifiedAt !== null,
      verifiedAt: agent.ensVerifiedAt ?? null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /agents/:agentId/connect-token
 *
 * Mints a short-lived, project-and-agent-scoped credential the owner can paste
 * into `agentmesh connect`. Authorisation lives in the service: project member
 * plus agent owner. Returns the plaintext token once; it is stored hashed.
 */
export const createAgentConnectToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError();
    }

    const agentId = req.params.agentId as string;
    const purpose = req.body?.purpose === 'mcp' ? 'mcp' : 'connect';
    const issued = await agentConnectTokenService.issue(agentId, actorUserId, purpose);

    res.status(201).json({
      token: issued.token,
      agentId: issued.agentId,
      projectId: issued.projectId,
      expiresAt: issued.expiresAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /agents/:agentId/connect-tokens
 *
 * Revokes every credential the agent holds and closes its live connections,
 * so a leaked or no-longer-wanted token stops working immediately.
 */
export const revokeAgentConnectTokens = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError();
    }
    const agentId = req.params.agentId as string;
    const revoked = await agentConnectTokenService.revokeAll(agentId, actorUserId);
    const { connectionManager } = await import('../websocket/connection.manager.js');
    const closed = connectionManager.closeAgentConnections(agentId, 4003, 'Agent credentials revoked');
    res.status(200).json({ revoked, disconnected: closed });
  } catch (error) {
    next(error);
  }
};
