import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createAgent,
  listProjectAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  getAgentIdentity,
  createAgentConnectToken,
  revokeAgentConnectTokens,
} from '../controllers/agent.controller.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { config } from '../config/index.js';

const router: Router = Router();

router.use(requireAuth);

// Agent Endpoints
router.post('/projects/:projectId/agents', createAgent);
router.get('/projects/:projectId/agents', listProjectAgents);
router.get('/agents/:agentId', getAgent);
router.patch('/agents/:agentId', updateAgent);
router.delete('/agents/:agentId', deleteAgent);

// ENS Identity
router.get('/agents/:agentId/identity', getAgentIdentity);

// Short-lived credential a BYOA agent process uses to open its WebSocket.
router.post(
  '/agents/:agentId/connect-token',
  rateLimit({ name: 'connect token', windowMs: 60_000, max: config.rateLimits.tokens }),
  createAgentConnectToken,
);
router.delete('/agents/:agentId/connect-tokens', revokeAgentConnectTokens);

export default router;
