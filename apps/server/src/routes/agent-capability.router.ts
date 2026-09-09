import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  addCapability,
  listCapabilities,
  removeCapability,
  executePaidCapability,
} from '../controllers/agent-capability.controller.js';

const router: Router = Router();

// Agent Capability Endpoints
router.use(requireAuth);
router.post('/agents/:agentId/capabilities', addCapability);
router.get('/agents/:agentId/capabilities', listCapabilities);
router.delete('/agents/:agentId/capabilities/:capability', removeCapability);

// Paid Capability Execution Endpoint (PRD-36 x402 Payment Gate)
router.post('/agents/:agentId/capabilities/:capability/execute', executePaidCapability);

export default router;
