import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
};
