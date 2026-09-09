import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors/app-error.js';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    if ('conflicts' in err && Array.isArray((err as unknown as { conflicts: unknown }).conflicts)) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
        conflicts: (err as unknown as { conflicts: unknown }).conflicts,
      });
      return;
    }

    if ('approvalRequestId' in err) {
      const appReqErr = err as unknown as { approvalRequestId: string; approvalRequest: unknown };
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
        approvalRequestId: appReqErr.approvalRequestId,
        approvalRequest: appReqErr.approvalRequest,
      });
      return;
    }

    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[]) || [];
      res.status(409).json({
        error: 'CONFLICT',
        message: `Unique constraint failed on field(s): ${target.join(', ')}`,
      });
      return;
    }

    if (err.code === 'P2025') {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Requested record was not found',
      });
      return;
    }
  }

  console.error('[UnhandledError]', err);
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected internal error occurred',
  });
};
