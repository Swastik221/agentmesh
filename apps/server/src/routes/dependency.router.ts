import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createDependency,
  listDependencies,
  getDependencyReadiness,
  removeDependency,
} from '../controllers/dependency.controller.js';

export const dependencyRouter: Router = Router({ mergeParams: true });

dependencyRouter.use(requireAuth);

const prefixes = ['/projects/:projectId', '/api/projects/:projectId'];

for (const prefix of prefixes) {
  dependencyRouter.post(`${prefix}/tasks/:taskId/dependencies`, createDependency);
  dependencyRouter.get(`${prefix}/tasks/:taskId/dependencies`, listDependencies);
  dependencyRouter.get(`${prefix}/tasks/:taskId/dependencies/readiness`, getDependencyReadiness);
  dependencyRouter.delete(`${prefix}/tasks/:taskId/dependencies/:dependencyId`, removeDependency);
}
