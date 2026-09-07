import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createWorkspace,
  getWorkspace,
  getWorkspaceState,
} from './workspace.controller.js';

const router: Router = Router();

const prefixes = ['/projects/:projectId/workspace', '/api/projects/:projectId/workspace'];

for (const prefix of prefixes) {
  router.get(`${prefix}/state`, requireAuth, getWorkspaceState);
  router.post(prefix, requireAuth, createWorkspace);
  router.get(prefix, requireAuth, getWorkspace);
}

export default router;
