import express, { Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import healthRouter from './routes/health.router.js';
import userRouter from './routes/user.router.js';
import projectRouter from './routes/project.router.js';
import agentRouter from './routes/agent.router.js';
import agentCapabilityRouter from './routes/agent-capability.router.js';
import authRouter from './auth/auth.routes.js';
import projectBrainRouter from './project-brain/project-brain.routes.js';
import taskRouter from './tasks/task.routes.js';
import executionRouter from './execution/execution.routes.js';
import workspaceRouter from './workspace/workspace.routes.js';
import worktreeRouter from './git/worktree.routes.js';
import coordinatorRouter from './routes/coordinator.router.js';
import { artifactRouter } from './routes/artifact.router.js';
import { dependencyRouter } from './routes/dependency.router.js';
import activityRouter from './routes/activity.router.js';
import { errorHandler } from './middleware/error.middleware.js';
import { config } from './config/index.js';

export const createApp = (): Express => {
  const app = express();

  app.use(
    cors({
      origin: config.webOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  app.use('/', healthRouter);
  app.use('/', authRouter);
  app.use('/', userRouter);
  app.use('/', projectRouter);
  app.use('/', agentRouter);
  app.use('/', agentCapabilityRouter);
  app.use('/', projectBrainRouter);
  app.use('/', taskRouter);
  app.use('/', executionRouter);
  app.use('/', workspaceRouter);
  app.use('/', worktreeRouter);
  app.use('/', coordinatorRouter);
  app.use('/', artifactRouter);
  app.use('/', dependencyRouter);
  app.use('/', activityRouter);

  app.use(errorHandler);

  return app;
};
