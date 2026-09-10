import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { listActivity } from '../controllers/activity.controller.js';

const router: Router = Router();

const prefixes = ['/projects/:projectId/activity', '/api/projects/:projectId/activity'];

for (const prefix of prefixes) {
  router.get(prefix, requireAuth, listActivity);
}

export default router;