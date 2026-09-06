import express, { Express } from 'express';
import cors from 'cors';
import healthRouter from './routes/health.router.js';
import { errorHandler } from './middleware/error.middleware.js';
import { config } from './config/index.js';

export const createApp = (): Express => {
  const app = express();

  app.use(
    cors({
      origin: config.webOrigin,
    }),
  );
  app.use(express.json());

  app.use('/', healthRouter);

  app.use(errorHandler);

  return app;
};
