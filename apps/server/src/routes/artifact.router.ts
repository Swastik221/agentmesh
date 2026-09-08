import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createArtifact,
  listArtifacts,
  getArtifact,
} from '../controllers/artifact.controller.js';

export const artifactRouter: Router = Router({ mergeParams: true });

artifactRouter.use(requireAuth);

const prefixes = ['/projects/:projectId', '/api/projects/:projectId'];

for (const prefix of prefixes) {
  artifactRouter.post(`${prefix}/tasks/:taskId/artifacts`, createArtifact);
  artifactRouter.get(`${prefix}/tasks/:taskId/artifacts`, listArtifacts);
  artifactRouter.get(`${prefix}/artifacts/:artifactId`, getArtifact);
}
