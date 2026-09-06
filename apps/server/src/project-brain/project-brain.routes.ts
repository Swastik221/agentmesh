import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createEntry,
  listEntries,
  getEntry,
  updateEntry,
  deleteEntry,
  getProjectBrain,
} from './project-brain.controller.js';

const router: Router = Router();

const prefixes = ['/api/projects/:projectId/brain', '/projects/:projectId/brain'];

for (const prefix of prefixes) {
  router.post(`${prefix}/entries`, requireAuth, createEntry);
  router.get(`${prefix}/entries`, requireAuth, listEntries);
  router.get(`${prefix}/entries/:entryId`, requireAuth, getEntry);
  router.put(`${prefix}/entries/:entryId`, requireAuth, updateEntry);
  router.delete(`${prefix}/entries/:entryId`, requireAuth, deleteEntry);
  router.get(prefix, requireAuth, getProjectBrain);
}

export default router;
