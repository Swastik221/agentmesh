import { Request, Response, NextFunction } from 'express';
import { agentService } from '../services/agent.service.js';
import { createAgentSchema, updateAgentSchema } from '../schemas/agent.schema.js';

export const createAgent = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const input = createAgentSchema.parse(req.body);
    const agent = await agentService.createAgent(projectId, input);
    res.status(201).json(agent);
  } catch (error) {
    next(error);
  }
};

export const listProjectAgents = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const capability = req.query.capability as string | undefined;
    const agents = await agentService.listProjectAgents(projectId, capability);
    res.status(200).json(agents);
  } catch (error) {
    next(error);
  }
};

export const getAgent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const agent = await agentService.getAgent(agentId);
    res.status(200).json(agent);
  } catch (error) {
    next(error);
  }
};

export const updateAgent = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const input = updateAgentSchema.parse(req.body);
    const agent = await agentService.updateAgent(agentId, input);
    res.status(200).json(agent);
  } catch (error) {
    next(error);
  }
};

export const deleteAgent = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    await agentService.deleteAgent(agentId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
