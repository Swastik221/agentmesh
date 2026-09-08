import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createWorktree,
  getWorktree,
  listWorktrees,
  removeWorktree,
} from './worktree.controller.js';

const router: Router = Router();

const prefixes = ['/projects/:projectId', '/api/projects/:projectId'];

for (const prefix of prefixes) {
  router.post(`${prefix}/executions/:executionId/worktree`, requireAuth, createWorktree);
  router.get(`${prefix}/executions/:executionId/worktree`, requireAuth, getWorktree);
  router.get(`${prefix}/worktrees`, requireAuth, listWorktrees);
  router.post(`${prefix}/worktrees/:worktreeId/remove`, requireAuth, removeWorktree);
}

export default router;
