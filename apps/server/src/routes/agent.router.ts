import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createAgent,
  listProjectAgents,
  getAgent,
  updateAgent,
  deleteAgent,
} from '../controllers/agent.controller.js';

const router: Router = Router();

router.use(requireAuth);

// Agent Endpoints
router.post('/projects/:projectId/agents', createAgent);
router.get('/projects/:projectId/agents', listProjectAgents);
router.get('/agents/:agentId', getAgent);
router.patch('/agents/:agentId', updateAgent);
router.delete('/agents/:agentId', deleteAgent);

export default router;
