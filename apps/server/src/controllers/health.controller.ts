import { Request, Response } from 'express';
import { HealthStatus } from '@agentmesh/shared';

export const getHealth = (_req: Request, res: Response<HealthStatus>): void => {
  res.status(200).json({
    status: 'ok',
    service: 'agentmesh-server',
  });
};
