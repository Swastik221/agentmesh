import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { UnauthorizedError } from '../errors/app-error.js';
import { policyService } from '../services/policy.service.js';
import { createPolicySchema, updatePolicySchema } from '../schemas/policy.schema.js';

export const createPolicy = async (
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
    const input = createPolicySchema.parse(req.body);

    const policy = await policyService.createPolicy(projectId, actorUserId, input);
    res.status(201).json(policy);
  } catch (error) {
    next(error);
  }
};

export const listPolicies = async (
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
    const policies = await policyService.listPolicies(projectId, actorUserId);
    res.json({ policies });
  } catch (error) {
    next(error);
  }
};

export const getPolicyById = async (
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
    const policyId = req.params.policyId as string;
    const policy = await policyService.getPolicyById(projectId, policyId, actorUserId);
    res.json(policy);
  } catch (error) {
    next(error);
  }
};

export const updatePolicy = async (
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
    const policyId = req.params.policyId as string;
    const input = updatePolicySchema.parse(req.body);

    const policy = await policyService.updatePolicy(projectId, policyId, actorUserId, input);
    res.json(policy);
  } catch (error) {
    next(error);
  }
};

export const deletePolicy = async (
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
    const policyId = req.params.policyId as string;
    const policy = await policyService.deletePolicy(projectId, policyId, actorUserId);
    res.json({ message: 'Policy deleted successfully', policy });
  } catch (error) {
    next(error);
  }
};
