import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createTask,
  listTasks,
  getTask,
  updateTask,
  deleteTask,
  assignResponsibility,
  listResponsibilities,
  removeResponsibility,
  createTaskOffer,
  claimTaskOffer,
  listOfferCandidates,
  addDependency,
  listDependencies,
  removeDependency,
} from './task.controller.js';

const router: Router = Router();

const prefixes = ['/projects/:projectId/tasks', '/api/projects/:projectId/tasks'];

for (const prefix of prefixes) {
  router.post(prefix, requireAuth, createTask);
  router.get(prefix, requireAuth, listTasks);
  // Open offers on the shared board, before the :taskId routes so that
  // "offers" can never be matched as a task id.
  router.post(`${prefix}/offers`, requireAuth, createTaskOffer);
  router.get(`${prefix}/offers/candidates`, requireAuth, listOfferCandidates);

  router.get(`${prefix}/:taskId`, requireAuth, getTask);
  router.patch(`${prefix}/:taskId`, requireAuth, updateTask);
  router.delete(`${prefix}/:taskId`, requireAuth, deleteTask);

  router.post(`${prefix}/:taskId/claim`, requireAuth, claimTaskOffer);

  router.post(`${prefix}/:taskId/responsibilities`, requireAuth, assignResponsibility);
  router.get(`${prefix}/:taskId/responsibilities`, requireAuth, listResponsibilities);
  router.delete(
    `${prefix}/:taskId/responsibilities/:agentId`,
    requireAuth,
    removeResponsibility,
  );

  router.post(`${prefix}/:taskId/dependencies`, requireAuth, addDependency);
  router.get(`${prefix}/:taskId/dependencies`, requireAuth, listDependencies);
  router.delete(
    `${prefix}/:taskId/dependencies/:dependsOnTaskId`,
    requireAuth,
    removeDependency,
  );
}

export default router;
