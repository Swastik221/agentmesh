import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createEntry,
  listEntries,
  getEntry,
  updateEntry,
  deleteEntry,
} from './project-brain.controller.js';

const router: Router = Router();

const prefixes = ['/projects/:projectId/brain', '/api/projects/:projectId/brain'];

for (const prefix of prefixes) {
  router.post(prefix, requireAuth, createEntry);
  router.get(prefix, requireAuth, listEntries);
  router.get(`${prefix}/:entryId`, requireAuth, getEntry);
  router.patch(`${prefix}/:entryId`, requireAuth, updateEntry);
  router.delete(`${prefix}/:entryId`, requireAuth, deleteEntry);
}

export default router;
