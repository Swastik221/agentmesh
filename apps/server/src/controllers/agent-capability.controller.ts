import { Request, Response, NextFunction } from 'express';
import { agentCapabilityService } from '../services/agent-capability.service.js';
import { addCapabilitySchema } from '../schemas/agent-capability.schema.js';

export const addCapability = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const input = addCapabilitySchema.parse(req.body);
    const capabilityRecord = await agentCapabilityService.addCapability(agentId, input.capability);
    res.status(201).json(capabilityRecord);
  } catch (error) {
    next(error);
  }
};

export const listCapabilities = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const result = await agentCapabilityService.listCapabilities(agentId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const removeCapability = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const capability = req.params.capability as string;
    await agentCapabilityService.removeCapability(agentId, capability);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
