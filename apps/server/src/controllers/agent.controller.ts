import { Response, NextFunction } from 'express';
import { agentService } from '../services/agent.service.js';
import { createAgentSchema, updateAgentSchema } from '../schemas/agent.schema.js';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { UnauthorizedError } from '../errors/app-error.js';

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
