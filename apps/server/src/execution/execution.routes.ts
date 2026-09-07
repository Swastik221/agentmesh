import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createExecution,
  listExecutions,
  getExecution,
} from './execution.controller.js';

const router: Router = Router();

const prefixes = [
  '/projects/:projectId/tasks/:taskId/executions',
  '/api/projects/:projectId/tasks/:taskId/executions',
];

for (const prefix of prefixes) {
  router.post(prefix, requireAuth, createExecution);
  router.get(prefix, requireAuth, listExecutions);
  router.get(`${prefix}/:executionId`, requireAuth, getExecution);
}

export default router;
