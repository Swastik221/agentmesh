import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { assignTask } from '../controllers/coordinator.controller.js';

const router: Router = Router();

const prefixes = ['/projects/:projectId/tasks/:taskId/assign', '/api/projects/:projectId/tasks/:taskId/assign'];

for (const prefix of prefixes) {
  router.post(prefix, requireAuth, assignTask);
}

export default router;
