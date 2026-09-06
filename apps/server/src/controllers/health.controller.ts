import { Request, Response } from 'express';
import { HealthStatus } from '@agentmesh/shared';
import { prisma } from '../lib/prisma.js';

export const getHealth = async (_req: Request, res: Response<HealthStatus>): Promise<void> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'ok',
      service: 'agentmesh-server',
      database: 'connected',
    });
  } catch (error) {
    console.error('[HealthCheck] Database connection error:', (error as Error).message);
    res.status(200).json({
      status: 'degraded',
      service: 'agentmesh-server',
      database: 'disconnected',
    });
  }
};
